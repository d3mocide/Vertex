from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import EntityMissionTag
from deps import get_db

router = APIRouter(tags=["entity_tags"])


class EntityMissionTagCreate(BaseModel):
    tag: str = Field(min_length=1, max_length=64)
    color: str = Field(default="#FFB800", max_length=16)


class EntityMissionTagResponse(BaseModel):
    id: int
    entity_id: str
    tag: str
    color: str
    created_by: Optional[str]
    created_at: datetime


@router.get("/entities/{entity_id}/tags", response_model=list[EntityMissionTagResponse])
async def list_entity_tags(entity_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(EntityMissionTag)
        .where(EntityMissionTag.entity_id == entity_id)
        .order_by(EntityMissionTag.created_at)
    )
    return [EntityMissionTagResponse.model_validate(r, from_attributes=True) for r in result.scalars().all()]


@router.post("/entities/{entity_id}/tags", response_model=EntityMissionTagResponse, status_code=201)
async def create_entity_tag(
    entity_id: str,
    body: EntityMissionTagCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    created_by: Optional[str] = getattr(getattr(request.state, "user", None), "username", None)
    tag = EntityMissionTag(
        entity_id=entity_id,
        tag=body.tag.strip(),
        color=body.color,
        created_by=created_by,
        created_at=datetime.now(timezone.utc),
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return EntityMissionTagResponse.model_validate(tag, from_attributes=True)


@router.delete("/entities/{entity_id}/tags/{tag_id}", status_code=204)
async def delete_entity_tag(entity_id: str, tag_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(EntityMissionTag).where(
            EntityMissionTag.id == tag_id,
            EntityMissionTag.entity_id == entity_id,
        )
    )
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(404, "Tag not found")
    await db.delete(tag)
    await db.commit()
