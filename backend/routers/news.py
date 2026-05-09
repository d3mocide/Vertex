import json
from fastapi import APIRouter, Query
from redis_bus import get_redis

router = APIRouter(prefix="/news", tags=["news"])


@router.get("")
async def get_news(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    raw = await get_redis().get("feed:news:local")
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(items, list):
        return []
    return items[offset : offset + limit]
