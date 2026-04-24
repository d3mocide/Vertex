import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/summary", tags=["summary"])


@router.get("")
async def get_summary():
    raw = await get_redis().get("feed:summary:latest")
    if not raw:
        return {"summary": "No summary available yet.", "ts": None, "model": None}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"summary": "No summary available yet.", "ts": None, "model": None}
