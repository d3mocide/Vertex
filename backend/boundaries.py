"""
Boundary lookup for geofence creation: city/county limits and ZIP code areas.

- City and county names resolve through the self-hosted Nominatim
  (GEOCODER_URL): a free-form search finds a point in the named place, and
  reverse geocoding at city/county zoom returns that administrative
  boundary. Nothing leaves the LAN.
- 5-digit ZIP codes resolve to Census ZIP Code Tabulation Areas via the US
  Census TIGERweb service (OpenStreetMap has no US ZIP polygons). This sends
  the ZIP code searched for to census.gov; disable with
  BOUNDARY_ZIP_LOOKUP_ENABLED=false.
"""
from __future__ import annotations

import logging
import math
import re

import httpx
from shapely.geometry import mapping, shape

from config import settings

logger = logging.getLogger(__name__)

_TIGER_ZCTA = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
               "tigerWMS_Current/MapServer/2/query")
_TIMEOUT = httpx.Timeout(15.0)
# ~10 m simplification: invisible at map zoom, keeps stored fences small.
_SIMPLIFY_DEG = 0.0001
# Nominatim reverse zoom levels for administrative boundaries.
_ZOOM = {"city": 10, "county": 8}


class BoundaryLookupError(RuntimeError):
    pass


def _candidate(name: str, kind: str, source: str, geojson: dict, ref: str) -> dict | None:
    try:
        geom = shape(geojson)
    except Exception:
        return None
    if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.is_empty:
        return None
    simplified = geom.simplify(_SIMPLIFY_DEG, preserve_topology=True)
    # Rough area (degrees² scaled at this latitude) — for display only.
    lat = simplified.centroid.y
    km2 = simplified.area * (111.32 ** 2) * max(0.1, abs(math.cos(math.radians(lat))))
    return {
        "id": ref,
        "name": name,
        "kind": kind,
        "source": source,
        "area_km2": round(km2, 1),
        "geojson": mapping(simplified),
    }


async def _nominatim(client: httpx.AsyncClient, path: str, params: dict):
    if not settings.geocoder_url:
        raise BoundaryLookupError("City lookup needs GEOCODER_URL (self-hosted Nominatim) to be configured")
    resp = await client.get(f"{settings.geocoder_url.rstrip('/')}/{path}", params={"format": "jsonv2", **params})
    resp.raise_for_status()
    return resp.json()


async def _places(client: httpx.AsyncClient, query: str) -> list[dict]:
    """City and county boundaries matching `query` in the configured state."""
    state = settings.geocoder_state.lower()
    out: dict[str, dict] = {}

    def keep(r: dict, kind: str) -> None:
        if r.get("category") != "boundary" or not r.get("geojson"):
            return
        addr = r.get("address") or {}
        # Place names repeat across states (there are 30 Washington Counties).
        if (addr.get("state") or "").lower() not in ("", state):
            return
        ref = f"osm:{r.get('osm_type')}:{r.get('osm_id')}"
        if ref not in out:
            label = f"{r.get('name')}, {addr.get('state') or settings.geocoder_state}"
            cand = _candidate(label, kind, "OpenStreetMap (local Nominatim)", r["geojson"], ref)
            if cand:
                out[ref] = cand

    # 1. Administrative boundaries matched by name. The query goes in as typed:
    #    appending ", <state>" makes Nominatim match streets instead of the city.
    hits = await _nominatim(client, "search", {
        "q": query, "limit": 10, "countrycodes": "us", "polygon_geojson": 1, "addressdetails": 1,
    })
    for r in hits:
        kind = "county" if "county" in (r.get("name") or "").lower() else "city"
        keep(r, kind)

    # 2. Fallback: boundaries around places that match (e.g. a street in the city).
    if not out:
        pts = await _nominatim(client, "search", {"q": f"{query}, {settings.geocoder_state}", "limit": 3, "countrycodes": "us"})
        for hit in pts[:3]:
            for kind, zoom in _ZOOM.items():
                r = await _nominatim(client, "reverse", {
                    "lat": hit["lat"], "lon": hit["lon"], "zoom": zoom, "polygon_geojson": 1, "addressdetails": 1,
                })
                if isinstance(r, dict):
                    keep(r, kind)

    # Exact-name matches first; counties first when the query asks for one.
    ql = query.split(",")[0].strip().lower()
    want_county = "county" in ql
    return sorted(out.values(), key=lambda c: (
        not c["name"].lower().startswith(ql),
        (c["kind"] != "county") if want_county else (c["kind"] != "city"),
    ))


async def _zip(client: httpx.AsyncClient, zipcode: str) -> list[dict]:
    if not settings.boundary_zip_lookup_enabled:
        raise BoundaryLookupError("ZIP lookup is disabled (BOUNDARY_ZIP_LOOKUP_ENABLED=false)")
    resp = await client.get(_TIGER_ZCTA, params={
        "where": f"ZCTA5='{zipcode}'", "outFields": "ZCTA5", "f": "geojson",
        "outSR": 4326, "geometryPrecision": 5,
    })
    resp.raise_for_status()
    out = []
    for f in resp.json().get("features") or []:
        cand = _candidate(f"ZIP {zipcode}", "zip", "US Census ZCTA (TIGERweb)", f.get("geometry") or {}, f"zcta:{zipcode}")
        if cand:
            out.append(cand)
    return out


async def search_boundaries(query: str) -> list[dict]:
    """Return boundary candidates for a city/county name or a 5-digit ZIP code."""
    query = query.strip()
    if not query:
        return []
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers={"User-Agent": "Vertex/1.0 boundary lookup"}) as client:
        try:
            if re.fullmatch(r"\d{5}", query):
                return await _zip(client, query)
            return await _places(client, query)
        except httpx.HTTPError as exc:
            logger.warning("[boundaries] lookup failed for %r: %s", query, exc)
            raise BoundaryLookupError("Boundary service unavailable") from exc
