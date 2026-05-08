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
    r = get_redis()
    raw = await r.get(f"entity:{entity_id}")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


async def get_all_entities(entity_type: str | None = None) -> list[dict]:
    r = get_redis()
    keys: list[str] = []
    cur: int = 0
    while True:
        cur, batch = await r.scan(cur, match="entity:*", count=100)
        keys.extend(batch)
        if cur == 0:
            break
    if not keys:
        return []
    pipeline = r.pipeline()
    for key in keys:
        pipeline.get(key)
    results = await pipeline.execute()

    entities = []
    for raw in results:
        if not raw or isinstance(raw, Exception):
            continue
        try:
            entities.append(json.loads(raw))
        except (json.JSONDecodeError, TypeError):
            continue

    if entity_type:
        entities = [e for e in entities if e.get("entity_type") == entity_type]
    return entities


async def subscribe_updates():
    r = get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe("civic:updates")
    return pubsub


async def get_aircraft_snapshot() -> dict | None:
    r = get_redis()
    raw = await r.get("feed:aircraft_snapshot")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
