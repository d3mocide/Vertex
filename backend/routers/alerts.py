import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def get_alerts():
    raw = await get_redis().get("feed:alerts:flash")
    return json.loads(raw) if raw else []
