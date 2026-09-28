"""
Local geocoding for radio-derived incident locations (self-hosted Nominatim).

Addresses come from dispatch audio, e.g. "1221 SW 4th Ave" or
"NW 9th Ave & NW Lovejoy St". Street addresses use Nominatim's structured
search, bounded to the operating box. Intersections are not something
Nominatim answers directly, so both streets are fetched with their line
geometry and the crossing point is computed in PostGIS.

Every answer — including misses — is cached in Redis, so each distinct
location is looked up once. Callers that must not wait on the network (the
hourly briefing) use `cache_only=True`.

Disabled entirely when GEOCODER_URL is blank.
"""
from __future__ import annotations

import json
import logging
import re
import time

import httpx

from config import settings

logger = logging.getLogger(__name__)

_CACHE_KEY = "geocode:cache"
_HIT_TTL_S = 90 * 86400
_MISS_TTL_S = 7 * 86400
_TIMEOUT = httpx.Timeout(10.0)
# Intersections: accept a near-miss between the two streets up to this distance
# (OSM ways often stop a few metres short of the centre line they meet).
_INTERSECTION_TOLERANCE_M = 40
# Nominatim's maximum results per query.
_MAX_SEGMENTS = 40
# Sentinel for Geocoder.lookups once the service has failed in this pass.
_EXHAUSTED = 10**9


def cache_key(location: str) -> str:
    return re.sub(r"\s+", " ", location.strip().lower())


def _viewbox() -> str:
    # Nominatim viewbox order: left, top, right, bottom (lon/lat).
    return f"{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon},{settings.bbox_min_lat}"


def _in_bbox(lat: float, lon: float) -> bool:
    return (settings.bbox_min_lat <= lat <= settings.bbox_max_lat
            and settings.bbox_min_lon <= lon <= settings.bbox_max_lon)


def _extent(lines: list[dict], pad: float = 0.005) -> str:
    """Nominatim viewbox (left,top,right,bottom) around GeoJSON lines, padded ~500 m."""
    pts = []
    for g in lines:
        coords = g["coordinates"] if g["type"] == "LineString" else [c for part in g["coordinates"] for c in part]
        pts.extend(coords)
    lons, lats = [p[0] for p in pts], [p[1] for p in pts]
    return ",".join(f"{round(v, 6):g}" for v in (min(lons) - pad, max(lats) + pad, max(lons) + pad, min(lats) - pad))


def is_geocodable(location: str | None) -> bool:
    """Street addresses and intersections only — not landmarks or bare highways."""
    if not location or "(landmark)" in location:
        return False
    return bool(re.match(r"^\d+ ", location)) or " & " in location


class Geocoder:
    def __init__(self, redis, pool=None, client: httpx.AsyncClient | None = None):
        self.redis = redis
        self.pool = pool
        self._client = client
        self.base = settings.geocoder_url.rstrip("/")
        self.lookups = 0  # live lookups performed (for rate limiting / logging)

    @property
    def enabled(self) -> bool:
        return bool(self.base)

    async def _get(self, params: dict) -> list:
        client = self._client or httpx.AsyncClient(timeout=_TIMEOUT)
        try:
            # No "state": the bounded viewbox already confines results to the
            # region, and after a data refresh (2026-09-27) the self-hosted
            # Nominatim returned nothing for any structured query carrying
            # state=Oregon — 90% of dispatch addresses went unlocated.
            resp = await client.get(f"{self.base}/search", params={
                "format": "jsonv2", "countrycodes": "us", "viewbox": _viewbox(), "bounded": 1,
                **params,
            })
            resp.raise_for_status()
            return resp.json()
        finally:
            if self._client is None:
                await client.aclose()

    async def _cached(self, key: str):
        raw = await self.redis.hget(_CACHE_KEY, key)
        if not raw:
            return None
        entry = json.loads(raw)
        ttl = _HIT_TTL_S if entry.get("lat") is not None else _MISS_TTL_S
        if time.time() - entry.get("ts", 0) > ttl:
            return None
        return entry

    async def _store(self, key: str, lat: float | None, lon: float | None, how: str,
                     corrected: str | None = None) -> dict:
        entry = {"lat": lat, "lon": lon, "how": how, "corrected": corrected, "ts": time.time()}
        await self.redis.hset(_CACHE_KEY, key, json.dumps(entry))
        return entry

    async def geocode(self, location: str | None, cache_only: bool = False) -> tuple[float, float] | None:
        """Return (lat, lon) for an extracted incident location, or None."""
        entry = await self.lookup(location, cache_only)
        return (entry["lat"], entry["lon"]) if entry else None

    async def lookup(self, location: str | None, cache_only: bool = False) -> dict | None:
        """Resolve a location to {"lat", "lon", "how", "corrected"}, or None.

        `corrected` is set when the street name heard on the radio was
        replaced by a real street (see street_names.py) to get the match.
        """
        if not self.enabled or not is_geocodable(location):
            return None
        key = cache_key(location)
        entry = await self._cached(key)
        if entry is None:
            if cache_only:
                return None
            self.lookups += 1
            try:
                point, how, corrected = await self._resolve(location)
            except Exception as exc:
                # Service down or slow: don't cache, and stop live lookups for
                # the rest of this pass so a dead geocoder can't stall the caller.
                logger.warning("[geocoder] lookup failed for %r (%s) — pausing live lookups this cycle", location, exc)
                self.lookups = _EXHAUSTED
                return None
            entry = await self._store(key, *(point or (None, None)), how if point else "miss", corrected)
        return entry if entry.get("lat") is not None else None

    async def _resolve(self, location: str) -> tuple[tuple[float, float] | None, str, str | None]:
        """Exact lookup first; on a miss, retry with fuzzy street-name corrections."""
        from street_names import suggest

        if " & " in location:
            a, b = location.split(" & ", 1)
            point = await self._intersection(a, b)
            if point:
                return point, "intersection", None
            alt_a = [a] + await suggest(self.pool, a, 2)
            alt_b = [b] + await suggest(self.pool, b, 2)
            for ca in alt_a:
                for cb in alt_b:
                    if (ca, cb) == (a, b):
                        continue
                    point = await self._intersection(ca, cb)
                    if point:  # validated: the corrected streets really cross
                        return point, "intersection_fuzzy", f"{ca} & {cb}"
            return None, "miss", None

        point = await self._address(location)
        if point:
            return point, "address", None
        num, _, street = location.partition(" ")
        for alt in await suggest(self.pool, street, 2):
            corrected = f"{num} {alt}"
            point = await self._address(corrected)
            if point:  # validated: this exact house number exists on the corrected street
                return point, "address_fuzzy", corrected
        return None, "miss", None

    async def _address(self, location: str) -> tuple[float, float] | None:
        results = await self._get({"street": location, "limit": 1, "addressdetails": 1})
        for r in results:
            # When the house number is unknown Nominatim falls back to the
            # street itself — possibly kilometres long. A wrong pin (and wrong
            # geofence tag) is worse than none, so only exact matches count.
            if not (r.get("address") or {}).get("house_number"):
                continue
            lat, lon = float(r["lat"]), float(r["lon"])
            if _in_bbox(lat, lon):
                return lat, lon
        return None

    async def _street_geojson(self, street: str, viewbox: str | None = None) -> list[dict]:
        # dedupe=0: by default Nominatim merges same-named segments and returns
        # only a handful, usually missing the one that meets the cross street.
        params = {"street": street, "limit": _MAX_SEGMENTS, "dedupe": 0, "polygon_geojson": 1}
        if viewbox:
            params["viewbox"] = viewbox
        results = await self._get(params)
        return [r["geojson"] for r in results
                if isinstance(r.get("geojson"), dict) and r["geojson"].get("type") in ("LineString", "MultiLineString")]

    async def _intersection(self, a: str, b: str) -> tuple[float, float] | None:
        if self.pool is None:
            return None
        lines_a, lines_b = await self._street_geojson(a), await self._street_geojson(b)
        if not lines_a or not lines_b:
            return None
        # A long road can exceed the result cap; re-query it only within the
        # other (shorter) street's extent, which is where they can cross.
        if len(lines_a) >= _MAX_SEGMENTS and len(lines_b) < _MAX_SEGMENTS:
            lines_a = await self._street_geojson(a, _extent(lines_b)) or lines_a
        elif len(lines_b) >= _MAX_SEGMENTS and len(lines_a) < _MAX_SEGMENTS:
            lines_b = await self._street_geojson(b, _extent(lines_a)) or lines_b
        row = await self.pool.fetchrow(
            """
            WITH a AS (SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)) AS g FROM unnest($1::text[]) g),
                 b AS (SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(g), 4326)) AS g FROM unnest($2::text[]) g),
                 x AS (SELECT a.g AS ga, b.g AS gb, ST_Intersection(a.g, b.g) AS i FROM a, b),
                 p AS (SELECT CASE
                                WHEN NOT ST_IsEmpty(i) THEN ST_Centroid(i)
                                WHEN ST_DWithin(ga::geography, gb::geography, $3) THEN ST_ClosestPoint(ga, gb)
                              END AS pt
                       FROM x)
            SELECT ST_Y(pt) AS lat, ST_X(pt) AS lon FROM p WHERE pt IS NOT NULL
            """,
            [json.dumps(g) for g in lines_a], [json.dumps(g) for g in lines_b], _INTERSECTION_TOLERANCE_M,
        )
        if row and _in_bbox(row["lat"], row["lon"]):
            return row["lat"], row["lon"]
        return None
