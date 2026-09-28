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


@router.get("/advisories")
async def get_advisories():
    """Ranked advisories for the top-of-app bar (poller/advisories.py).

    Same payload the poller publishes as feed:advisories over the WebSocket;
    used for the initial load.
    """
    empty = {"ts": None, "level": "green", "count": 0, "items": []}
    raw = await get_redis().get("feed:advisories")
    if not raw:
        return empty
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return empty
    return data if isinstance(data, dict) else empty
