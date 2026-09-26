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
            resp = await client.get(f"{self.base}/search", params={
                "format": "jsonv2", "countrycodes": "us", "viewbox": _viewbox(), "bounded": 1, **params,
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

    async def _store(self, key: str, lat: float | None, lon: float | None, how: str) -> dict:
        entry = {"lat": lat, "lon": lon, "how": how, "ts": time.time()}
        await self.redis.hset(_CACHE_KEY, key, json.dumps(entry))
        return entry

    async def geocode(self, location: str | None, cache_only: bool = False) -> tuple[float, float] | None:
        """Return (lat, lon) for an extracted incident location, or None."""
        if not self.enabled or not is_geocodable(location):
            return None
        key = cache_key(location)
        entry = await self._cached(key)
        if entry is None:
            if cache_only:
                return None
            self.lookups += 1
            try:
                if " & " in location:
                    point = await self._intersection(*location.split(" & ", 1))
                    how = "intersection"
                else:
                    point = await self._address(location)
                    how = "address"
            except Exception as exc:
                # Service down or slow: don't cache, and stop live lookups for
                # the rest of this pass so a dead geocoder can't stall the caller.
                logger.warning("[geocoder] lookup failed for %r (%s) — pausing live lookups this cycle", location, exc)
                self.lookups = _EXHAUSTED
                return None
            entry = await self._store(key, *(point or (None, None)), how if point else "miss")
        if entry.get("lat") is None:
            return None
        return entry["lat"], entry["lon"]

    async def _address(self, location: str) -> tuple[float, float] | None:
        results = await self._get({"street": location, "state": "Oregon", "limit": 1})
        for r in results:
            lat, lon = float(r["lat"]), float(r["lon"])
            if _in_bbox(lat, lon):
                return lat, lon
        return None

    async def _street_geojson(self, street: str) -> list[dict]:
        results = await self._get({"street": street, "state": "Oregon", "limit": 10, "polygon_geojson": 1})
        return [r["geojson"] for r in results
                if isinstance(r.get("geojson"), dict) and r["geojson"].get("type") in ("LineString", "MultiLineString")]

    async def _intersection(self, a: str, b: str) -> tuple[float, float] | None:
        if self.pool is None:
            return None
        lines_a, lines_b = await self._street_geojson(a), await self._street_geojson(b)
        if not lines_a or not lines_b:
            return None
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
