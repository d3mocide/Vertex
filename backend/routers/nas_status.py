"""FAA NAS Status (ATCSCC programs) at the airports the operator watches. The poller keeps it in Redis."""
import json

from fastapi import APIRouter

from redis_bus import get_redis

router = APIRouter(prefix="/nas-status", tags=["nas-status"])


@router.get("")
async def nas_status():
    raw = await get_redis().get("feed:faa:nas_status")
    try:
        data = json.loads(raw) if raw else None
    except (TypeError, ValueError):
        data = None
    return data or {"updated": "", "programs": []}
