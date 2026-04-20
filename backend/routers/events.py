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
    db: AsyncSession = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = select(Event).where(Event.ts >= cutoff).order_by(Event.ts.desc())
    if severity:
        query = query.where(Event.severity == severity)
    result = await db.execute(query)
    return result.scalars().all()
