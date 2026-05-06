import json
import logging
from redis.asyncio import Redis
from config import settings

logger = logging.getLogger(__name__)

_redis: Redis | None = None


async def get_bus() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def publish_entity(entity: dict, ttl: int = 120, record_observation: bool = True):
    r = await get_bus()
    key = f"entity:{entity['entity_id']}"

    should_publish = True
    if settings.adsb_publish_only_changes:
        previous_raw = await r.get(key)
        if previous_raw:
            try:
                previous = json.loads(previous_raw)
                should_publish = _entity_changed(previous, entity)
            except Exception:
                should_publish = True

    await r.set(key, json.dumps(entity), ex=ttl)
    if should_publish:
        await r.publish("civic:updates", json.dumps({"type": "entity_update", "data": entity}))

    from db import write_entity_observation  # lazy import — db imports geofence which imports bus
    if not should_publish and settings.adsb_publish_only_changes:
        return

    try:
        await write_entity_observation(entity, record_observation=record_observation)
    except Exception as exc:
        import traceback
        logger.warning("DB write failed for %s: %s\n%s", entity.get("entity_id"), exc, traceback.format_exc())


async def set_feed(key: str, data):
    r = await get_bus()
    payload = json.dumps(data)
    await r.set(f"feed:{key}", payload)
    # Radio active state gets its own typed message so the frontend can react immediately
    msg_type = "radio_update" if key == "radio:active" else "feed_update"
    await r.publish("civic:updates", json.dumps({"type": msg_type, "key": key, "data": data}))


async def set_aircraft_snapshot(snapshot: dict):
    r = await get_bus()
    await r.set("feed:aircraft_snapshot", json.dumps(snapshot))
    await r.publish("civic:updates", json.dumps({"type": "aircraft_snapshot", "data": snapshot}))


async def close():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None


def _entity_changed(previous: dict, current: dict) -> bool:
    # Core positional and state fields that should trigger updates
    compare_keys = (
        "entity_type",
        "source",
        "display_name",
        "lat",
        "lon",
        "altitude",
        "heading",
        "speed",
        "vertical_rate",
        "status",
        "identity",
        "tags",
        # BEAST-specific fields that represent meaningful state changes
        "position_stale",
        "signal_peak",
        "msg_count",
        "mlat_ticks",
        "trail_pts",
        "comm_b",
    )
    for key in compare_keys:
        if previous.get(key) != current.get(key):
            return True
    return False
