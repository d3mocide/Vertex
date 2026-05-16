import asyncio
import json
import logging
import time

import httpx
from fastapi import APIRouter, HTTPException

from redis_bus import get_redis

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rail"])

# Oregon + SW Washington bounding box for OSM rail track queries.
# Overpass format: south,west,north,east
_BBOX = "41.9,-124.6,47.0,-116.4"
_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_CACHE_TTL_S = 86_400  # 24 hours — rail infrastructure changes infrequently
_REDIS_KEY = "cache:rail:tracks"

# In-process fallback so a warm backend doesn't hit Redis on every request
_mem: dict = {"data": None, "ts": 0.0}
_fetch_lock = asyncio.Lock()

# In-process cache for poller-written GTFS route shapes
_gtfs_mem: dict = {"data": None, "ts": 0.0}


def _build_query() -> str:
    return (
        f"[out:json][timeout:90][maxsize:104857600];"
        f"("
        f'way["railway"~"^(rail|light_rail)$"]({_BBOX});'
        f");"
        f"out geom;"
    )


def _to_geojson(elements: list[dict]) -> dict:
    features = []
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geom]
        tags = el.get("tags") or {}
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "osm_id": el.get("id"),
                "railway": tags.get("railway"),
                "name": tags.get("name") or tags.get("operator"),
                "maxspeed": tags.get("maxspeed"),
                "electrified": tags.get("electrified"),
            },
        })
    return {"type": "FeatureCollection", "features": features}


async def _fetch() -> dict:
    query = _build_query()
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            _OVERPASS_URL,
            content=f"data={query}",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)",
            },
        )
        resp.raise_for_status()
    data = resp.json()
    return _to_geojson(data.get("elements", []))


@router.get("/rail/tracks")
async def get_rail_tracks():
    """OSM rail track geometry as GeoJSON (24-hour cache, Redis-backed)."""
    now = time.monotonic()

    # 1. In-process memory hit (avoids Redis round-trip for warm instances)
    if _mem["data"] is not None and (now - _mem["ts"]) < _CACHE_TTL_S:
        return _mem["data"]

    # 2. Redis hit (survives backend restarts)
    try:
        r = get_redis()
        cached_raw = await r.get(_REDIS_KEY)
        if cached_raw:
            geojson = json.loads(cached_raw)
            _mem["data"] = geojson
            _mem["ts"] = now
            return geojson
    except Exception as exc:
        logger.warning("[rail] Redis read failed, will fetch from Overpass: %s", exc)

    # 3. Fetch from Overpass under lock (prevents stampede)
    async with _fetch_lock:
        now = time.monotonic()
        if _mem["data"] is not None and (now - _mem["ts"]) < _CACHE_TTL_S:
            return _mem["data"]

        try:
            geojson = await _fetch()
        except Exception as exc:
            logger.error("[rail] Overpass fetch failed: %s", exc)
            if _mem["data"] is not None:
                return _mem["data"]
            raise HTTPException(status_code=503, detail="Rail track data temporarily unavailable")

        _mem["data"] = geojson
        _mem["ts"] = time.monotonic()
        logger.info("[rail] fetched %d track segments from Overpass", len(geojson["features"]))

        try:
            r = get_redis()
            await r.set(_REDIS_KEY, json.dumps(geojson), ex=_CACHE_TTL_S)
        except Exception as exc:
            logger.warning("[rail] Redis write failed (cache not persisted): %s", exc)

        return geojson


@router.get("/rail/gtfs-shapes")
async def get_gtfs_shapes():
    """TriMet GTFS route shapes as GeoJSON (written by poller into Redis, 24-hour TTL).

    Returns an empty FeatureCollection when the poller hasn't populated the cache yet
    (e.g., TRIMET_GTFS_ENABLED=false or first boot before the static GTFS has been fetched).
    """
    redis_key = "cache:gtfs:trimet:shapes"
    now = time.monotonic()

    if _gtfs_mem["data"] is not None and (now - _gtfs_mem["ts"]) < _CACHE_TTL_S:
        return _gtfs_mem["data"]

    try:
        r = get_redis()
        cached_raw = await r.get(redis_key)
        if cached_raw:
            geojson = json.loads(cached_raw)
            _gtfs_mem["data"] = geojson
            _gtfs_mem["ts"] = now
            return geojson
    except Exception as exc:
        logger.warning("[rail] Redis GTFS shapes read failed: %s", exc)

    return {"type": "FeatureCollection", "features": []}
