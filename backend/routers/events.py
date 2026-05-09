from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from deps import get_db
from db.models import Event
from schemas.event import EventSchema

router = APIRouter(tags=["events"])


@router.get("/events", response_model=list[EventSchema])
async def list_events(
    hours: int = Query(24, ge=1, le=168),
    severity: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = select(Event).where(Event.ts >= cutoff).order_by(Event.ts.desc())
    if severity:
        query = query.where(Event.severity == severity)
    if event_type:
        query = query.where(Event.event_type == event_type)
    if entity_id:
        query = query.where(Event.entity_id == entity_id)
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()
