import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/utilities", tags=["utilities"])


@router.get("/pge")
async def get_pge_status():
    raw = await get_redis().get("feed:utility:pge")
    if not raw:
        return {
            "provider": "PGE",
            "status": "Operational",
            "active_outages": 0,
            "customers_affected": 0,
            "last_updated": "—",
            "reliability": 100
        }
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {
            "provider": "PGE",
            "status": "Operational",
            "active_outages": 0,
            "customers_affected": 0,
            "last_updated": "—",
            "reliability": 100
        }
