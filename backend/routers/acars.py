from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select, desc, distinct

from db.session import async_session_factory
from db.models import AcarsMessage

router = APIRouter(prefix="/acars", tags=["acars"])


class AcarsMessageResponse(BaseModel):
    id: int
    station_id: Optional[str]
    tail: Optional[str]
    flight: Optional[str]
    freq: Optional[str]
    label: Optional[str]
    msg_num: Optional[str]
    msg_text: Optional[str]
    error: int
    mode: Optional[str]
    ts: datetime


def _to_response(m: AcarsMessage) -> AcarsMessageResponse:
    return AcarsMessageResponse(
        id=m.id,
        station_id=m.station_id,
        tail=m.tail,
        flight=m.flight,
        freq=m.freq,
        label=m.label,
        msg_num=m.msg_num,
        msg_text=m.msg_text,
        error=m.error,
        mode=m.mode,
        ts=m.ts,
    )


@router.get("/messages", response_model=list[AcarsMessageResponse])
async def get_acars_messages(
    tail: Optional[str] = Query(None, description="Filter by tail/registration (exact match)"),
    flight: Optional[str] = Query(None, description="Filter by flight number (case-insensitive prefix)"),
    limit: int = Query(50, ge=1, le=500),
):
    async with async_session_factory() as session:
        stmt = select(AcarsMessage).order_by(desc(AcarsMessage.ts)).limit(limit)
        if tail:
            stmt = stmt.where(AcarsMessage.tail == tail.upper())
        if flight:
            stmt = stmt.where(AcarsMessage.flight.ilike(f"{flight}%"))
        result = await session.execute(stmt)
        rows = result.scalars().all()
    return [_to_response(r) for r in rows]


@router.get("/tails", response_model=list[str])
async def get_acars_tails():
    """Return the distinct tail/registration marks that have ACARS messages.

    Used by the Flight Log panel to badge aircraft rows that have ACARS history
    without fetching the full message list for every aircraft in the log.
    """
    async with async_session_factory() as session:
        result = await session.execute(
            select(distinct(AcarsMessage.tail)).where(AcarsMessage.tail.isnot(None))
        )
        tails = [row[0].upper() for row in result.all() if row[0]]
    return tails
