import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def get_alerts():
    raw = await get_redis().get("feed:alerts:flash")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
