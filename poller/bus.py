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


async def publish_entity(entity: dict, ttl: int = 120):
    r = await get_bus()
    await r.set(f"entity:{entity['entity_id']}", json.dumps(entity), ex=ttl)
    await r.publish("civic:updates", json.dumps({"type": "entity_update", "data": entity}))
    from db import write_entity_observation  # lazy import — db imports geofence which imports bus
    try:
        await write_entity_observation(entity)
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


async def close():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
