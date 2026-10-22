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


def _route_summary(f):
    p = f.get("properties", {})
    return {"id": p.get("id"), "feed": p.get("feed"), "route_id": p.get("route_id"), "type": p.get("route_type"),
            "short_name": p.get("route_short_name", ""), "long_name": p.get("route_long_name", ""),
            "color": p.get("route_color"), "text_color": p.get("route_text_color"), "attribution": p.get("attribution")}


async def _stops(feed: str):
    """An agency's stop index (`stops`: id -> [name, lat, lon]; `routes`: route id -> directions of ordered stop ids)."""
    if feed + "-transit" not in PROVIDERS or len(feed) > 64:
        raise HTTPException(status_code=404, detail="Unknown transit feed")
    raw = await get_redis().get("cache:transit:" + feed + ":stops")
    if not raw:
        raise HTTPException(status_code=404, detail="Stops unavailable")
    return json.loads(raw)


async def _alerts():
    """Active service alerts of every agency in use, each tagged with its feed (the agency's cache key name)."""
    redis, out = get_redis(), []
    async for key in redis.scan_iter(match="cache:transit:*:alerts"):
        key = key.decode() if isinstance(key, bytes) else key
        raw = await redis.get(key)
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            continue
        feed = key.split(":")[2]
        out += [{**a, "feed": feed, "agency": payload.get("label") or feed} for a in payload.get("alerts", [])
                if isinstance(a, dict)]
    return out


@router.get("/transit/alerts")
async def get_transit_alerts():
    """Service alerts for routes in the monitoring area (and agency-wide notices), newest first."""
    labels = {(f["properties"].get("feed"), f["properties"].get("route_id")): f["properties"].get("route_short_name")
              or f["properties"].get("route_long_name") or f["properties"].get("route_id")
              for f in (await get_transit_routes())["features"]}
    alerts = [{**a, "route_labels": [str(labels.get((a["feed"], rid), rid)) for rid in a.get("routes", [])]} for a in await _alerts()]
    return sorted(alerts, key=lambda a: a.get("start") or 0, reverse=True)


@router.get("/transit/route-list")
async def get_transit_route_list():
    """Every route in the monitoring area without its geometry, for browsing."""
    collection = await get_transit_routes()
    counts = {}
    for alert in await _alerts():
        for rid in alert.get("routes", []):
            counts[(alert["feed"], rid)] = counts.get((alert["feed"], rid), 0) + 1
    return sorted(({**_route_summary(f), "alerts": counts.get((f["properties"].get("feed"), f["properties"].get("route_id")), 0)}
                   for f in collection["features"]),
                  key=lambda r: (r["feed"] or "", r["type"] is None, r["type"], str(r["short_name"]).zfill(6), r["long_name"]))


@router.get("/transit/route/{feed}/{route_id}")
async def get_transit_route(feed: str, route_id: str):
    """One route: its geometry and, for each direction, the stops in order."""
    if len(route_id) > 128 or not route_id:
        raise HTTPException(status_code=404, detail="Route unavailable")
    collection = await get_transit_routes()
    feature = next((f for f in collection["features"] if f.get("properties", {}).get("id") == feed + ":" + route_id), None)
    if feature is None:
        raise HTTPException(status_code=404, detail="Route unavailable")
    index = await _stops(feed)
    directions = []
    for pattern in index.get("routes", {}).get(route_id, []):
        stops = [{"id": sid, "name": index["stops"][sid][0], "lat": index["stops"][sid][1], "lon": index["stops"][sid][2]}
                 for sid in pattern["s"] if sid in index["stops"]]
        directions.append({"headsign": pattern["h"], "stops": stops})
    alerts = [a for a in await _alerts() if a["feed"] == feed and (route_id in a.get("routes", []) or a.get("agency_wide"))]
    return {"route": _route_summary(feature), "geometry": feature["geometry"], "directions": directions,
            "alerts": sorted(alerts, key=lambda a: a.get("start") or 0, reverse=True)}


@router.get("/transit/stop/{feed}/{stop_id}")
async def get_transit_stop(feed: str, stop_id: str):
    """A stop and the routes that call at it (static pattern only: no arrival times)."""
    index = await _stops(feed)
    stop = index["stops"].get(stop_id)
    if stop is None:
        raise HTTPException(status_code=404, detail="Stop unavailable")
    summaries = {f["properties"].get("route_id"): _route_summary(f) for f in (await get_transit_routes())["features"]
                 if f.get("properties", {}).get("feed") == feed}
    serving = sorted({rid for rid, patterns in index.get("routes", {}).items() if any(stop_id in p["s"] for p in patterns)})
    return {"id": stop_id, "feed": feed, "name": stop[0], "lat": stop[1], "lon": stop[2],
            "routes": [summaries[rid] for rid in serving if rid in summaries]}


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
