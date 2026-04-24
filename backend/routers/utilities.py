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


@router.get("/oregon")
async def get_oregon_status():
    raw = await get_redis().get("feed:utility:oregon")
    if not raw:
        return {
            "provider": "Oregon ODIN",
            "status": "Operational",
            "state_affected": 0,
            "metro_affected": 0,
            "pge_affected": 0,
            "pacificorp_affected": 0,
            "last_updated": "—"
        }
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {
            "provider": "Oregon ODIN",
            "status": "Operational",
            "state_affected": 0,
            "metro_affected": 0,
            "pge_affected": 0,
            "pacificorp_affected": 0,
            "last_updated": "—"
        }
