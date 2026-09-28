from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from deps import get_db
from db.models import Observation, Event
from schemas.observation import ObservationSchema

router = APIRouter(tags=["observations"])

# Replay: only things that move, thinned to one point per bucket per entity.
_REPLAY_TYPES = ("aircraft", "vessel", "train", "aprs")
_REPLAY_BUCKETS = [(3 * 3600, 10), (12 * 3600, 30), (48 * 3600, 60), (float("inf"), 300)]  # (window s, bucket s)
_REPLAY_MAX_POINTS = 250_000
_REPLAY_MAX_EVENTS = 2_000


@router.get("/entities/{entity_id}/trail", response_model=list[ObservationSchema])
async def get_trail(
    entity_id: str,
    minutes: int = Query(30, ge=1, le=1440),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    result = await db.execute(
        select(Observation)
        .where(Observation.entity_id == entity_id, Observation.ts >= cutoff)
        .order_by(Observation.ts)
    )
    return result.scalars().all()


@router.get("/observations/replay")
async def get_replay(
    start: datetime = Query(..., description="Replay window start (ISO 8601)"),
    end: datetime = Query(None,  description="Replay window end (ISO 8601, default: now)"),
    entity_type: str | None = Query(None, description="Filter by entity type"),
    include_events: bool = Query(False, description="Include system events in replay window"),
    db: AsyncSession = Depends(get_db),
):
    """Observations of moving things in a time window, grouped by entity_id.

    Only types that move (aircraft, vessels, trains, APRS stations) are
    replayed; gauges, mesh nodes and the like sit still. Each entity keeps at
    most one point per time bucket, sized to the window (10 s for up to 3 h,
    up to 5 min for multi-day), so a long window returns every entity
    instead of the first N rows alphabetically. Capped at 30 days back; end
    defaults to now.
    """
    now = datetime.now(timezone.utc)
    if end is None:
        end = now
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    start = max(start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start,
                now - timedelta(days=30))

    window_s = max(1.0, (end - start).total_seconds())
    bucket_s = next(b for limit, b in _REPLAY_BUCKETS if window_s <= limit)
    types = [entity_type] if entity_type else list(_REPLAY_TYPES)

    # The bucket is inlined (an int from _REPLAY_BUCKETS, never user input):
    # DISTINCT ON and ORDER BY must be the identical expression, which two
    # separately numbered bind parameters are not.
    bucket_expr = f"floor(extract(epoch FROM o.ts) / {int(bucket_s)})"
    result = await db.execute(text(f"""
        SELECT DISTINCT ON (o.entity_id, {bucket_expr})
               o.entity_id, e.entity_type, e.display_name, o.ts, o.lat, o.lon, o.altitude, o.heading, o.speed
        FROM observations o
        JOIN entities e ON e.entity_id = o.entity_id
        WHERE o.ts >= :start AND o.ts <= :end
          AND o.lat IS NOT NULL AND o.lon IS NOT NULL
          AND e.entity_type = ANY(:types)
        ORDER BY o.entity_id, {bucket_expr}, o.ts
        LIMIT :cap
    """), {"start": start, "end": end, "types": types, "cap": _REPLAY_MAX_POINTS + 1})
    rows = result.all()
    truncated = len(rows) > _REPLAY_MAX_POINTS
    rows = rows[:_REPLAY_MAX_POINTS]

    grouped: dict[str, dict] = {}
    for row in rows:
        if row.entity_id not in grouped:
            grouped[row.entity_id] = {
                "entity_type": row.entity_type,
                "display_name": row.display_name,
                "points": [],
            }
        grouped[row.entity_id]["points"].append({
            "ts":       row.ts.isoformat(),
            "lat":      row.lat,
            "lon":      row.lon,
            "altitude": row.altitude,
            "heading":  row.heading,
            "speed":    row.speed,
        })

    response: dict = {
        "start":    start.isoformat(),
        "end":      end.isoformat(),
        "bucket_s": bucket_s,
        "truncated": truncated,
        "entities": grouped,
    }

    if include_events:
        ev_result = await db.execute(
            select(Event)
            .where(Event.ts >= start, Event.ts <= end)
            .order_by(Event.ts)
            .limit(_REPLAY_MAX_EVENTS)
        )
        response["events"] = [
            {
                "event_id":   ev.event_id,
                "event_type": ev.event_type,
                "entity_id":  ev.entity_id,
                "ts":         ev.ts.isoformat(),
                "severity":   ev.severity,
                "summary":    ev.summary,
            }
            for ev in ev_result.scalars()
        ]

    return response
