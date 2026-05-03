from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Annotation
from deps import get_db

router = APIRouter(prefix="/annotations", tags=["annotations"])


class AnnotationCreate(BaseModel):
    annotation_type: Literal["marker", "line", "polygon"]
    label: Optional[str] = None
    color: str = "#FFB800"
    geojson: dict
    expires_at: Optional[datetime] = None


class AnnotationResponse(BaseModel):
    id: int
    annotation_type: str
    label: Optional[str] = None
    color: str
    geojson: dict
    created_by: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime


def _to_response(a: Annotation) -> AnnotationResponse:
    return AnnotationResponse(
        id=a.id,
        annotation_type=a.annotation_type,
        label=a.label,
        color=a.color,
        geojson=a.geojson,
        created_by=a.created_by,
        expires_at=a.expires_at,
        created_at=a.created_at,
    )


@router.get("", response_model=list[AnnotationResponse])
async def list_annotations(db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    q = (
        select(Annotation)
        .where(or_(Annotation.expires_at.is_(None), Annotation.expires_at > now))
        .order_by(Annotation.id)
    )
    result = await db.execute(q)
    return [_to_response(a) for a in result.scalars().all()]


@router.post("", response_model=AnnotationResponse, status_code=201)
async def create_annotation(
    body: AnnotationCreate, request: Request, db: AsyncSession = Depends(get_db)
):
    created_by = getattr(request.state, "user", None)
    a = Annotation(
        annotation_type=body.annotation_type,
        label=body.label,
        color=body.color,
        geojson=body.geojson,
        created_by=created_by,
        expires_at=body.expires_at,
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return _to_response(a)


@router.delete("/{annotation_id}", status_code=204)
async def delete_annotation(annotation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Annotation not found")
    await db.delete(a)
    await db.commit()
