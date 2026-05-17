import asyncio
import json
import logging
import time

from fastapi import APIRouter

from redis_bus import get_redis

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rail"])

_CACHE_TTL_S = 86_400  # 24 hours
_REDIS_KEY = "cache:rail:tracks"

# In-process fallback so a warm backend doesn't hit Redis on every request
_mem: dict = {"data": None, "ts": 0.0}

# In-process cache for poller-written GTFS route shapes
_gtfs_mem: dict = {"data": None, "ts": 0.0}


@router.get("/rail/tracks")
async def get_rail_tracks():
    """OSM rail track geometry as GeoJSON (Redis-backed, populated by RailInfrastructurePoller)."""
    now = time.monotonic()

    # 1. In-process memory hit
    if _mem["data"] is not None and (now - _mem["ts"]) < _CACHE_TTL_S:
        return _mem["data"]

    # 2. Redis hit
    try:
        r = get_redis()
        cached_raw = await r.get(_REDIS_KEY)
        if cached_raw:
            geojson = json.loads(cached_raw)
            _mem["data"] = geojson
            _mem["ts"] = now
            return geojson
    except Exception as exc:
        logger.warning("[rail] Redis read failed: %s", exc)

    # If cache is empty, return empty collection (poller will populate it)
    return {"type": "FeatureCollection", "features": []}


@router.get("/rail/gtfs-shapes")
async def get_gtfs_shapes():
    """TriMet GTFS route shapes as GeoJSON (written by poller into Redis, 24-hour TTL)."""
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
