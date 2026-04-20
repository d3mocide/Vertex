import json
from redis.asyncio import Redis
from config import settings

_redis: Redis | None = None


async def get_bus() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def publish_entity(entity: dict):
    r = await get_bus()
    await r.set(f"entity:{entity['entity_id']}", json.dumps(entity))
    await r.publish("civic:updates", json.dumps({"type": "entity_update", "data": entity}))


async def set_feed(key: str, data):
    r = await get_bus()
    await r.set(f"feed:{key}", json.dumps(data))
    await r.publish("civic:updates", json.dumps({"type": "feed_update", "key": key}))


async def close():
    global _redis
    if _redis:
        await _redis.aclose()
        _redis = None
