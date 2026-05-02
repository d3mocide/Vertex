import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config_writer import add_entry, remove_entry, update_entry
from deps import get_db
from db.models import Event, RadioStream, Talkgroup
from redis_bus import get_redis

router = APIRouter(prefix="/radio", tags=["radio"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class RadioStreamCreate(BaseModel):
    name: str
    url: str
    format: str = "mp3"
    enabled: bool = True


class RadioStreamResponse(BaseModel):
    id: int
    name: str
    url: str
    format: str
    enabled: bool
    source: str


def _to_response(stream: RadioStream) -> RadioStreamResponse:
    return RadioStreamResponse(
        id=stream.id,
        name=stream.name,
        url=stream.url,
        format=stream.format,
        enabled=stream.enabled,
        source=stream.source,
    )


# ---------------------------------------------------------------------------
# Stream list endpoints (new)
# ---------------------------------------------------------------------------

@router.get("/streams", response_model=list[RadioStreamResponse])
async def list_streams(db: AsyncSession = Depends(get_db)):
    """All configured radio streams."""
    result = await db.execute(select(RadioStream).order_by(RadioStream.id))
    return [_to_response(s) for s in result.scalars().all()]


@router.post("/streams", response_model=RadioStreamResponse, status_code=201)
async def create_stream(body: RadioStreamCreate, db: AsyncSession = Depends(get_db)):
    """Add a new stream. Persisted to sources.yml (source=user) and DB."""
    stream = RadioStream(
        name=body.name,
        url=body.url,
        format=body.format,
        enabled=body.enabled,
        source="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(stream)
    await db.commit()
    await db.refresh(stream)
    await add_entry("radio_streams", {
        "name": stream.name,
        "url": stream.url,
        "format": stream.format,
        "enabled": stream.enabled,
        "source": "user",
    })
    return _to_response(stream)


@router.patch("/streams/{stream_id}/toggle", response_model=RadioStreamResponse)
async def toggle_stream(stream_id: int, db: AsyncSession = Depends(get_db)):
    """Toggle a stream's enabled state. Updates DB and sources.yml."""
    result = await db.execute(select(RadioStream).where(RadioStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(404, "Stream not found")
    stream.enabled = not stream.enabled
    stream.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(stream)
    await update_entry("radio_streams", stream.url, {"enabled": stream.enabled})
    return _to_response(stream)


@router.delete("/streams/{stream_id}", status_code=204)
async def delete_stream(stream_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a stream from DB and sources.yml."""
    result = await db.execute(select(RadioStream).where(RadioStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(404, "Stream not found")
    url = stream.url
    await db.delete(stream)
    await db.commit()
    await remove_entry("radio_streams", url)


# ---------------------------------------------------------------------------
# P25 talkgroup management
# ---------------------------------------------------------------------------

class TalkgroupCreate(BaseModel):
    tgid: int
    name: str
    priority: int = 3
    color: str = "#FFB800"
    scan_enabled: bool = True


class TalkgroupUpdate(BaseModel):
    name: Optional[str] = None
    priority: Optional[int] = None
    color: Optional[str] = None
    scan_enabled: Optional[bool] = None


class TalkgroupResponse(BaseModel):
    id: int
    tgid: int
    name: str
    priority: int
    color: str
    scan_enabled: bool


def _tg_to_response(tg: Talkgroup) -> TalkgroupResponse:
    return TalkgroupResponse(
        id=tg.id, tgid=tg.tgid, name=tg.name,
        priority=tg.priority, color=tg.color, scan_enabled=tg.scan_enabled,
    )


@router.get("/talkgroups", response_model=list[TalkgroupResponse])
async def list_talkgroups(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Talkgroup).order_by(Talkgroup.priority, Talkgroup.tgid))
    return [_tg_to_response(tg) for tg in result.scalars().all()]


@router.post("/talkgroups", response_model=TalkgroupResponse, status_code=201)
async def create_talkgroup(body: TalkgroupCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Talkgroup).where(Talkgroup.tgid == body.tgid))
    if existing:
        raise HTTPException(409, f"Talkgroup {body.tgid} already exists")
    tg = Talkgroup(
        tgid=body.tgid, name=body.name, priority=body.priority,
        color=body.color, scan_enabled=body.scan_enabled,
    )
    db.add(tg)
    await db.commit()
    await db.refresh(tg)
    return _tg_to_response(tg)


@router.put("/talkgroups/{tgid}", response_model=TalkgroupResponse)
async def update_talkgroup(tgid: int, body: TalkgroupUpdate, db: AsyncSession = Depends(get_db)):
    tg = await db.scalar(select(Talkgroup).where(Talkgroup.tgid == tgid))
    if not tg:
        raise HTTPException(404, "Talkgroup not found")
    if body.name is not None:
        tg.name = body.name
    if body.priority is not None:
        tg.priority = body.priority
    if body.color is not None:
        tg.color = body.color
    if body.scan_enabled is not None:
        tg.scan_enabled = body.scan_enabled
    tg.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(tg)
    return _tg_to_response(tg)


@router.delete("/talkgroups/{tgid}", status_code=204)
async def delete_talkgroup(tgid: int, db: AsyncSession = Depends(get_db)):
    tg = await db.scalar(select(Talkgroup).where(Talkgroup.tgid == tgid))
    if not tg:
        raise HTTPException(404, "Talkgroup not found")
    await db.delete(tg)
    await db.commit()


# ---------------------------------------------------------------------------
# P25 live state
# ---------------------------------------------------------------------------

@router.get("/active")
async def get_active():
    """Current P25 talkgroup — reads live state from Redis."""
    raw = await get_redis().get("feed:radio:active")
    if not raw:
        return {"state": "idle", "tgid": None, "tag": None}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"state": "idle", "tgid": None, "tag": None}


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
