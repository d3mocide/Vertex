import json
from fastapi import APIRouter, Response
from redis_bus import get_redis

router = APIRouter(prefix="/summary", tags=["summary"])

# Must match _DEMAND_KEY in poller/pollers/summary.py
_DEMAND_KEY = "summary:generate_now"
# TTL for the flag — if the poller doesn't consume it within 2 min, it expires
_DEMAND_TTL_S = 120


@router.get("")
async def get_summary():
    raw = await get_redis().get("feed:summary:latest")
    if not raw:
        return {"summary": "No summary available yet.", "ts": None, "model": None}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"summary": "No summary available yet.", "ts": None, "model": None}


@router.post("/refresh", status_code=202)
async def request_summary_refresh():
    """Signal the summary poller to regenerate the AI briefing on the next tick.
    Returns 202 Accepted immediately — the updated summary arrives via WebSocket."""
    await get_redis().set(_DEMAND_KEY, "1", ex=_DEMAND_TTL_S)
    return Response(status_code=202)
