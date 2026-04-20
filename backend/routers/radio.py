import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from deps import get_db
from db.models import Event
from redis_bus import get_redis

router = APIRouter(prefix="/radio", tags=["radio"])


@router.get("/active")
async def get_active():
    """Current P25 talkgroup — reads live state from Redis."""
    raw = await get_redis().get("feed:radio:active")
    return json.loads(raw) if raw else {"state": "idle", "tgid": None, "tag": None}


@router.get("/calls")
async def get_calls(
    hours: int = Query(24, ge=1, le=168),
    tgid: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Recent P25 call events from Postgres."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    query = (
        select(Event)
        .where(
            Event.event_type.in_(["p25_call_start", "p25_call_end"]),
            Event.ts >= cutoff,
        )
        .order_by(Event.ts.desc())
    )
    result = await db.execute(query)
    events = result.scalars().all()

    if tgid:
        events = [e for e in events if e.details and e.details.get("tgid") == tgid]

    return [
        {
            "event_id":   e.event_id,
            "event_type": e.event_type,
            "ts":         e.ts.isoformat(),
            "summary":    e.summary,
            "details":    e.details,
        }
        for e in events
    ]


@router.get("/stream-url")
async def get_stream_url():
    """Icecast stream endpoint for the frontend audio player."""
    return {"url": "/stream/radio.mp3", "format": "mp3"}
