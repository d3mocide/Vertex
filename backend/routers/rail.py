import json
import logging
import time

from fastapi import APIRouter, HTTPException
from redis.exceptions import ResponseError

from provider_catalog import PROVIDERS

from redis_bus import get_redis

logger = logging.getLogger(__name__)
router = APIRouter(tags=["rail"])

_CACHE_TTL_S = 86_400  # 24 hours
_REDIS_KEY = "cache:rail:tracks"

# In-process fallback so a warm backend doesn't hit Redis on every request
_mem: dict = {"data": None, "ts": 0.0}


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


@router.get("/transit/routes")
async def get_transit_routes():
    raw = await get_redis().get("feed:transit:routes")
    return json.loads(raw) if raw else {"type": "FeatureCollection", "features": []}


@router.get("/transit/vehicles")
async def get_transit_vehicles():
    raw = await get_redis().get("feed:transit:vehicles")
    return json.loads(raw) if raw else []


@router.get("/transit/trip-shape/{feed}/{shape_id}")
async def get_transit_trip_shape(feed: str, shape_id: str):
    """The selected GTFS trip's published path, clipped to the monitoring area."""
    if feed + "-transit" not in PROVIDERS or len(shape_id) > 128 or not shape_id:
        raise HTTPException(status_code=404, detail="Trip shape unavailable")
    try:
        raw = await get_redis().hget("cache:transit:" + feed + ":paths", shape_id)
    except ResponseError:
        # During a rolling upgrade the previous cache may still be a string.
        raise HTTPException(status_code=404, detail="Trip shape unavailable") from None
    lines = json.loads(raw) if raw else None
    if not lines:
        raise HTTPException(status_code=404, detail="Trip shape unavailable")
    return {"type": "MultiLineString", "coordinates": lines}


@router.get("/rail/gtfs-shapes")
async def get_gtfs_shapes():
    """Selected transit sources' rail shapes; bus routes never become rail snapping paths."""
    collection = await get_transit_routes()
    return {**collection, "features": [f for f in collection["features"]
            if f.get("properties", {}).get("route_type") not in {3, 800}
            and not 700 <= f.get("properties", {}).get("route_type", -1) <= 799]}
