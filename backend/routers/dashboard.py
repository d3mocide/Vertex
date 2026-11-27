"""The last 24 hours at a glance for the dashboard and wall display.

The admin activity pages already count, per hour, the aircraft, vessels and mesh nodes seen, the radio calls
recorded and the dispatch incidents heard. Those routes are admin-only; this one hands a viewer the same hourly
shapes (counts only, nothing about any one entity) plus the busiest talkgroups, so the dashboard can show how
today compares with the rest of the day instead of only what is on screen this second.
"""
import json

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db, get_redis_client
from routers import admin

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_CACHE_KEY = "cache:dashboard_history"
_CACHE_S = 60
_SERIES = ("aircraft", "vessel", "mesh_node", "radio_call", "dispatch_incident")


def shape_history(activity: dict, talkgroups: list[dict]) -> dict:
    """Slim the admin entity-activity payload down to what the dashboard draws."""
    by_type = {t.get("entity_type"): t for t in activity.get("types") or []}
    series, totals = {}, {}
    for name in _SERIES:
        row = by_type.get(name) or {}
        hourly = row.get("hourly") or [0] * 24
        series[name] = [int(v or 0) for v in hourly][-24:]
        totals[name] = int(row.get("seen_24h") or 0)
    dispatch = (by_type.get("dispatch_incident") or {}).get("extra") or {}
    return {
        "series": series,
        "totals": totals,
        "dispatch_categories": [[str(k), int(v)] for k, v in (dispatch.get("categories") or [])],
        "life_safety_24h": int(dispatch.get("life_safety") or 0),
        "talkgroups": talkgroups[:5],
    }


async def _activity(db: AsyncSession) -> dict:
    r = get_redis_client()
    cached = await r.get(admin._ACTIVITY_CACHE_KEY)
    if cached:
        return json.loads(cached)
    data = await admin._compute_entity_activity(db)
    await r.set(admin._ACTIVITY_CACHE_KEY, json.dumps(data), ex=admin._ACTIVITY_CACHE_S)
    return data


async def _talkgroups(db: AsyncSession) -> list[dict]:
    rows = await db.execute(text("""
        SELECT details->>'tgid' AS tgid, MAX(details->>'tag') AS tag, COUNT(*) AS n
        FROM events
        WHERE event_type = 'p25_call_start' AND ts > now() - interval '24 hours' AND details->>'tgid' IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 5"""))
    return [{"tgid": r.tgid, "label": r.tag or None, "calls": r.n} for r in rows]


@router.get("/history")
async def get_dashboard_history(db: AsyncSession = Depends(get_db)):
    """Hourly counts for the last 24 h (oldest first, current hour last) and the busiest talkgroups."""
    r = get_redis_client()
    cached = await r.get(_CACHE_KEY)
    if cached:
        return json.loads(cached)
    data = shape_history(await _activity(db), await _talkgroups(db))
    await r.set(_CACHE_KEY, json.dumps(data), ex=_CACHE_S)
    return data
