import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("")
async def get_weather():
    raw = await get_redis().get("feed:weather:current")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


@router.get("/alerts")
async def get_weather_alerts():
    raw = await get_redis().get("feed:weather:alerts")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
