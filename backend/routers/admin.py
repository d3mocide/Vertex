from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Entity, Observation
from deps import get_db, get_redis_client

router = APIRouter(prefix="/admin", tags=["admin"])

_DEFAULT_RETENTION_DAYS = 30
_RETENTION_KEY = "config:retention_days"


class RetentionConfig(BaseModel):
    retention_days: int = Field(ge=1, le=365)


class StorageStats(BaseModel):
    observation_count: int
    entity_count: int
    entity_type_counts: dict[str, int]
    retention_days: int


@router.get("/storage", response_model=StorageStats)
async def get_storage(db: AsyncSession = Depends(get_db)):
    obs_count = await db.scalar(select(func.count(Observation.id))) or 0
    entity_count = await db.scalar(select(func.count(Entity.entity_id))) or 0
    type_rows = await db.execute(
        select(Entity.entity_type, func.count(Entity.entity_id)).group_by(Entity.entity_type)
    )
    type_counts = {row[0]: row[1] for row in type_rows}

    r = get_redis_client()
    raw = await r.get(_RETENTION_KEY)
    retention_days = int(raw) if raw else _DEFAULT_RETENTION_DAYS

    return StorageStats(
        observation_count=obs_count,
        entity_count=entity_count,
        entity_type_counts=type_counts,
        retention_days=retention_days,
    )


@router.post("/retention", response_model=RetentionConfig)
async def set_retention(body: RetentionConfig):
    r = get_redis_client()
    await r.set(_RETENTION_KEY, body.retention_days)
    return body
