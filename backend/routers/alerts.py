import json
from fastapi import APIRouter, Query
from redis_bus import get_redis

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def get_alerts(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    raw = await get_redis().get("feed:alerts:flash")
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(items, list):
        return []
    return items[offset : offset + limit]
