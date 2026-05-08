import json
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Annotation
from deps import get_db
from redis_bus import get_redis

router = APIRouter(prefix="/annotations", tags=["annotations"])


class AnnotationCreate(BaseModel):
    annotation_type: Literal["marker", "line", "polygon"]
    label: Optional[str] = None
    color: str = "#FFB800"
    geojson: dict
    expires_at: Optional[datetime] = None


class AnnotationUpdate(BaseModel):
    label: Optional[str] = None
    color: Optional[str] = None
    expires_at: Optional[datetime] = None
    clear_expiry: bool = False  # set true to make permanent


class AnnotationResponse(BaseModel):
    id: int
    annotation_type: str
    label: Optional[str] = None
    color: str
    geojson: dict
    created_by: Optional[str] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    tak_uid: Optional[str] = None


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
        tak_uid=a.tak_uid,
    )


async def _publish_annotation(action: str, annotation: Annotation) -> None:
    try:
        r = get_redis()
        payload = {
            "action": action,
            "id": annotation.id,
            "annotation_type": annotation.annotation_type,
            "label": annotation.label,
            "color": annotation.color,
            "geojson": annotation.geojson,
            "expires_at": annotation.expires_at.isoformat() if annotation.expires_at else None,
            "tak_uid": annotation.tak_uid,
            "source": "tak" if annotation.tak_uid else "vertex",
        }
        await r.publish("annotation_update", json.dumps(payload))
    except Exception:
        pass  # non-fatal — TAK bridge operates best-effort


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
    await _publish_annotation("create", a)
    return _to_response(a)


@router.put("/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: int, body: AnnotationUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Annotation not found")
    if body.label is not None:
        a.label = body.label or None
    if body.color is not None:
        a.color = body.color
    if body.clear_expiry:
        a.expires_at = None
    elif body.expires_at is not None:
        a.expires_at = body.expires_at
    await db.commit()
    await db.refresh(a)
    await _publish_annotation("update", a)
    return _to_response(a)


@router.delete("/{annotation_id}", status_code=204)
async def delete_annotation(annotation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Annotation).where(Annotation.id == annotation_id))
    a = result.scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Annotation not found")
    await _publish_annotation("delete", a)
    await db.delete(a)
    await db.commit()
