import json
from redis.asyncio import Redis
from config import settings

_redis: Redis | None = None


async def init_redis():
    global _redis
    _redis = Redis.from_url(settings.redis_url, decode_responses=True)


async def close_redis():
    if _redis:
        await _redis.aclose()


def get_redis() -> Redis:
    if _redis is None:
        raise RuntimeError("Redis not initialized")
    return _redis


async def get_entity_state(entity_id: str) -> dict | None:
    raw = await _redis.get(f"entity:{entity_id}")
    return json.loads(raw) if raw else None


async def get_all_entities(entity_type: str | None = None) -> list[dict]:
    keys = await _redis.keys("entity:*")
    if not keys:
        return []
    pipeline = _redis.pipeline()
    for key in keys:
        pipeline.get(key)
    results = await pipeline.execute()
    entities = [json.loads(r) for r in results if r]
    if entity_type:
        entities = [e for e in entities if e.get("entity_type") == entity_type]
    return entities


async def subscribe_updates():
    pubsub = _redis.pubsub()
    await pubsub.subscribe("civic:updates")
    return pubsub
