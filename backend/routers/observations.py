from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from deps import get_db
from db.models import Observation, Entity, Event
from schemas.observation import ObservationSchema

router = APIRouter(tags=["observations"])


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
    """Return all observations in a time window, grouped by entity_id.

    Capped at 30 days back; end defaults to now.
    """
    now = datetime.now(timezone.utc)
    if end is None:
        end = now
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    start = max(start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start,
                now - timedelta(days=30))

    query = (
        select(Observation, Entity.entity_type, Entity.display_name)
        .join(Entity, Observation.entity_id == Entity.entity_id)
        .where(
            Observation.ts >= start,
            Observation.ts <= end,
            Observation.lat.isnot(None),
            Observation.lon.isnot(None),
        )
        .order_by(Observation.entity_id, Observation.ts)
    )
    if entity_type:
        query = query.where(Entity.entity_type == entity_type)

    result = await db.execute(query)
    rows = result.all()

    grouped: dict[str, dict] = {}
    for obs, etype, dname in rows:
        if obs.entity_id not in grouped:
            grouped[obs.entity_id] = {
                "entity_type": etype,
                "display_name": dname,
                "points": [],
            }
        grouped[obs.entity_id]["points"].append({
            "ts":       obs.ts.isoformat(),
            "lat":      obs.lat,
            "lon":      obs.lon,
            "altitude": obs.altitude,
            "heading":  obs.heading,
            "speed":    obs.speed,
        })

    response: dict = {
        "start":    start.isoformat(),
        "end":      end.isoformat(),
        "entities": grouped,
    }

    if include_events:
        ev_result = await db.execute(
            select(Event)
            .where(Event.ts >= start, Event.ts <= end)
            .order_by(Event.ts)
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
