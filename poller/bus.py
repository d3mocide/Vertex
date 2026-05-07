import json
import logging
from redis.asyncio import Redis
from config import settings

logger = logging.getLogger(__name__)

_redis: Redis | None = None
# In-memory mirror of the last-published entity state per entity_id.
# Eliminates the Redis GET on every publish_entity call when adsb_publish_only_changes
# is enabled — the comparison is done locally instead of via a round-trip.
_entity_cache: dict[str, dict] = {}


async def get_bus() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def publish_entity(entity: dict, ttl: int = 120, record_observation: bool = True):
    r = await get_bus()
    entity_id = entity["entity_id"]
    key = f"entity:{entity_id}"

    should_publish = True
    if settings.adsb_publish_only_changes:
        previous = _entity_cache.get(entity_id)
        if previous is not None:
            should_publish = _entity_changed(previous, entity)

    # Always refresh the Redis TTL so the key stays alive while the entity is active.
    await r.set(key, json.dumps(entity), ex=ttl)

    if should_publish:
        _entity_cache[entity_id] = entity
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
        "position_stale",
        "trail_pts",
        "comm_b",
    )
    for key in compare_keys:
        if previous.get(key) != current.get(key):
            return True
    return False
