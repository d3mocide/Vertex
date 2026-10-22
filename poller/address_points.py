"""Local address points: where Nominatim has the street but not the house number.

OpenStreetMap often lacks house numbers, and the neighbouring numbers too, so a dispatch address on a rural road misses
and the incident has no pin. Counties and states publish address-point layers (the NENA NG911 schema: Add_Number,
St_PreDir, St_Name, St_PosTyp ...) as ArcGIS feature services. `ADDRESS_POINTS_URL` names one; this module loads the
points inside the region's bounding box into a table, refreshed monthly, and answers two questions for the geocoder:
the exact point for "29811 S Beavercreek Rd", and, when that number is not in the data, a point interpolated between
the nearest numbers on the same street ("29819" lies between 29811 and 29900). Interpolated pins are marked approximate.
"""
import asyncio
import logging
import math
import re
import time

import httpx

from config import settings
from security import send_pinned_http_request
from street_names import parse_street

logger = logging.getLogger(__name__)

_REFRESH_AFTER_S = 30 * 86400
_PAGE = 2000                     # the feature services' usual maxRecordCount
_MAX_PAGE_BYTES = 8 * 1024 * 1024  # a 2000-record page is well under 1 MB; anything far larger is not this service
_PAUSE_S = 0.2                   # be polite to a public server
_MAX_NUMBER_GAP = 300            # house numbers either side of the one heard that still count as neighbours
_MAX_SPAN_M = 1600               # the two neighbours must be this close, or the street bends away between them
_MAX_EXACT_SPREAD_M = 200        # points sharing one house number further apart than this are different places
_ONE_SIDED_GAP = 40              # past the last number on a street, only a close neighbour is trusted
_FIELDS = "Add_Number,ADDRESS_FULL"


def enabled() -> bool:
    return bool(settings.address_points_url)


async def ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS address_points ("
            " dir TEXT NOT NULL, core TEXT NOT NULL, suffix TEXT NOT NULL, num INTEGER NOT NULL,"
            " lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL,"
            " loaded_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_address_points_street ON address_points (core, suffix, num)")
        await conn.execute("CREATE TABLE IF NOT EXISTS address_points_source (id BOOLEAN PRIMARY KEY DEFAULT TRUE, signature TEXT NOT NULL)")


def _signature() -> str:
    """What the loaded points depend on: the service and the box they were cut to."""
    box = (settings.bbox_min_lat, settings.bbox_min_lon, settings.bbox_max_lat, settings.bbox_max_lon)
    return f"{settings.address_points_url.rstrip('/')}|" + ",".join(f"{v:.4f}" for v in box)


def _record(feature: dict):
    attrs, geom = feature.get("attributes") or {}, feature.get("geometry") or {}
    num, lon, lat = attrs.get("Add_Number"), geom.get("x"), geom.get("y")
    # STREET_NAME_FULL can omit the type ("Everett"); the full address carries it ("4733 Southeast Everett Street").
    street = re.sub(r"^\S*\d\S*\s+", "", (attrs.get("ADDRESS_FULL") or "").split(",")[0]).strip()
    parsed = parse_street(re.sub(r"\s+(?:unit|apt|suite|ste|bldg|building|space|lot|#)\b.*$", "", street, flags=re.I))
    if not parsed or not num or lat is None or lon is None:
        return None
    if not (settings.bbox_min_lat <= lat <= settings.bbox_max_lat and settings.bbox_min_lon <= lon <= settings.bbox_max_lon):
        return None
    return parsed[0], parsed[1], parsed[2], int(num), float(lat), float(lon)


async def _pages(client: httpx.AsyncClient):
    """Pages of features in OBJECTID order. Paging by key is fast on these services; a spatial filter or a deep
    resultOffset takes tens of seconds a page, so the region is cut out here instead."""
    url = settings.address_points_url.rstrip("/") + "/query"
    last = 0
    while True:
        # DNS-pinned like every other read of a configured GIS URL: a pack can supply this address as a default.
        resp = await send_pinned_http_request(client, "POST", url, data={
            "where": f"Add_Number IS NOT NULL AND OBJECTID > {last}", "outFields": "OBJECTID," + _FIELDS, "outSR": 4326,
            "returnGeometry": "true", "orderByFields": "OBJECTID", "resultRecordCount": _PAGE, "f": "json"})
        resp.raise_for_status()
        if len(resp.content) > _MAX_PAGE_BYTES:
            raise RuntimeError("address point service returned an oversized page")
        body = resp.json()
        if body.get("error"):
            raise RuntimeError(f"address point service error: {body['error'].get('message')}")
        features = body.get("features") or []
        if not features:
            return
        yield features
        if not body.get("exceededTransferLimit"):
            return
        last = max(int((f.get("attributes") or {}).get("OBJECTID") or 0) for f in features)
        await asyncio.sleep(_PAUSE_S)


async def refresh_if_stale(pool) -> int:
    """Load the address points when the table is empty or older than 30 days."""
    if not enabled():
        return 0
    await ensure_schema(pool)
    loaded_at = await pool.fetchval("SELECT extract(epoch FROM max(loaded_at)) FROM address_points")
    loaded_for = await pool.fetchval("SELECT signature FROM address_points_source")
    if loaded_at and loaded_for == _signature() and time.time() - float(loaded_at) < _REFRESH_AFTER_S:
        return 0
    rows: list[tuple] = []
    async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "Vertex/1.0 address gazetteer"}) as client:
        async for features in _pages(client):
            rows.extend(r for f in features if (r := _record(f)))
    if not rows:
        logger.warning("[address_points] the service returned no usable points — keeping the existing table")
        return 0
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("TRUNCATE address_points")
        await conn.copy_records_to_table("address_points", records=rows, columns=["dir", "core", "suffix", "num", "lat", "lon"])
        await conn.execute("INSERT INTO address_points_source (id, signature) VALUES (TRUE, $1)"
                           " ON CONFLICT (id) DO UPDATE SET signature = EXCLUDED.signature", _signature())
    logger.info("[address_points] loaded %d address points for geocoding", len(rows))
    return len(rows)


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    dlat = (b[0] - a[0]) * 111_320
    dlon = (b[1] - a[1]) * 111_320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)


def interpolate(num: int, known: list[tuple[int, float, float]]) -> tuple[float, float, bool] | None:
    """(lat, lon, exact) for house number `num` from the (number, lat, lon) points on one street, or None.

    An exact number wins. Otherwise the nearest lower and higher numbers (same odd/even side when there are any) are
    joined by a straight line and the point placed in proportion; it is refused when the neighbours are far apart,
    because the street may bend between them. Past the end of the numbering only a very close neighbour is used.
    """
    exact = [(la, lo) for n, la, lo in known if n == num]
    if exact:
        # Units at one address share a point; the same number on same-named streets in two towns does not, and their
        # average lies in open country. Refuse rather than pin a place nobody named.
        if any(_metres(exact[0], p) > _MAX_EXACT_SPREAD_M for p in exact[1:]):
            return None
        return sum(p[0] for p in exact) / len(exact), sum(p[1] for p in exact) / len(exact), True
    same_side = [k for k in known if k[0] % 2 == num % 2]
    pool = same_side or known
    lower = max((k for k in pool if k[0] < num), key=lambda k: k[0], default=None)
    upper = min((k for k in pool if k[0] > num), key=lambda k: k[0], default=None)
    if lower and upper:
        if upper[0] - lower[0] > 2 * _MAX_NUMBER_GAP or _metres(lower[1:], upper[1:]) > _MAX_SPAN_M:
            return None
        f = (num - lower[0]) / (upper[0] - lower[0])
        return lower[1] + f * (upper[1] - lower[1]), lower[2] + f * (upper[2] - lower[2]), False
    near = lower or upper
    if near and abs(near[0] - num) <= _ONE_SIDED_GAP:
        return near[1], near[2], False
    return None


async def locate(pool, location: str) -> tuple[float, float, bool] | None:
    """(lat, lon, exact) for "29819 S Beavercreek Rd" from the local address points, or None.

    A street heard without a direction counts only when one direction carries the numbers; an unlucky guess between
    "N Main St" and "S Main St" is worse than no pin."""
    if pool is None or not enabled():
        return None
    num_text, _, street = location.partition(" ")
    parsed = parse_street(street)
    if not num_text.isdigit() or not parsed:
        return None
    num, (direction, core, suffix) = int(num_text), parsed
    rows = await pool.fetch(
        "SELECT dir, num, lat, lon FROM address_points WHERE core = $1 AND suffix = $2 AND num BETWEEN $3 AND $4"
        " AND ($5 = '' OR dir = $5 OR dir = '')",
        core, suffix, num - _MAX_NUMBER_GAP, num + _MAX_NUMBER_GAP, direction)
    by_dir: dict[str, list[tuple[int, float, float]]] = {}
    for r in rows:
        by_dir.setdefault(r["dir"] or direction, []).append((r["num"], r["lat"], r["lon"]))
    found = {d: p for d, known in by_dir.items() if (p := interpolate(num, known))}
    if len(found) != 1:
        return None
    return next(iter(found.values()))
