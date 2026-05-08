import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/news", tags=["news"])


@router.get("")
async def get_news():
    raw = await get_redis().get("feed:news:local")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
