from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from deps import get_db
from db.models import Observation
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
