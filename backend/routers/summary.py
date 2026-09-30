import json
from fastapi import APIRouter, HTTPException, Query, Request, Response
from redis_bus import get_redis

router = APIRouter(prefix="/summary", tags=["summary"])

# Must match _DEMAND_KEY in poller/pollers/summary.py
_DEMAND_KEY = "summary:generate_now"
# Must match _HISTORY_KEY / _DEBUG_KEY in poller/pollers/summary.py
_HISTORY_KEY = "summary:history"
_DEBUG_KEY = "summary:last_run"
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


@router.get("/history")
async def get_summary_history(
    request: Request,
    limit: int = Query(24, ge=1, le=100),
    include_reasoning: bool = Query(False),
):
    """Past briefings, newest first. Reasoning traces are admin-only."""
    if include_reasoning and getattr(request.state, "role", "viewer") != "admin":
        raise HTTPException(403, "Admin role required for reasoning traces")
    rows = await get_redis().lrange(_HISTORY_KEY, 0, limit - 1)
    history = []
    for raw in rows:
        try:
            item = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if not include_reasoning:
            item.pop("reasoning", None)
        history.append(item)
    return history


@router.get("/metrics")
async def get_summary_metrics(limit: int = Query(24, ge=1, le=100)):
    """Per-briefing quality metrics (coverage, format, timing), newest first — for tracking prompt tuning."""
    rows = await get_redis().lrange(_HISTORY_KEY, 0, limit - 1)
    out = []
    for raw in rows:
        try:
            item = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        out.append({k: item.get(k) for k in ("ts", "model", "posture", "duration_s", "usage", "metrics")})
    return out


@router.get("/debug")
async def get_summary_debug():
    """Exact system/user prompt and response metadata from the last LLM run — for prompt tuning."""
    raw = await get_redis().get(_DEBUG_KEY)
    if not raw:
        return {"detail": "No briefing has been generated yet."}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"detail": "Last-run record is unreadable."}


@router.post("/refresh", status_code=202)
async def request_summary_refresh():
    """Signal the summary poller to regenerate the AI briefing on the next tick.
    Returns 202 Accepted immediately — the updated summary arrives via WebSocket."""
    await get_redis().set(_DEMAND_KEY, "1", ex=_DEMAND_TTL_S)
    return Response(status_code=202)
