from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db
from db.models import CustomLayer

router = APIRouter(prefix="/layers", tags=["layers"])


class LayerCreate(BaseModel):
    name: str
    geojson: dict
    style: Optional[dict] = None
    visible: bool = True


class LayerUpdate(BaseModel):
    name: Optional[str] = None
    style: Optional[dict] = None
    visible: Optional[bool] = None


class LayerResponse(BaseModel):
    id: int
    name: str
    geojson: dict
    style: Optional[dict]
    visible: bool
    created_at: str


def _to_response(layer: CustomLayer) -> LayerResponse:
    return LayerResponse(
        id=layer.id,
        name=layer.name,
        geojson=layer.geojson,
        style=layer.style,
        visible=layer.visible,
        created_at=layer.created_at.isoformat(),
    )


@router.get("", response_model=list[LayerResponse])
async def list_layers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CustomLayer).order_by(CustomLayer.id))
    return [_to_response(layer) for layer in result.scalars().all()]


@router.post("", response_model=LayerResponse, status_code=201)
async def create_layer(body: LayerCreate, db: AsyncSession = Depends(get_db)):
    layer = CustomLayer(
        name=body.name,
        geojson=body.geojson,
        style=body.style,
        visible=body.visible,
        created_at=datetime.now(timezone.utc),
    )
    db.add(layer)
    await db.commit()
    await db.refresh(layer)
    return _to_response(layer)


@router.put("/{layer_id}", response_model=LayerResponse)
async def update_layer(layer_id: int, body: LayerUpdate, db: AsyncSession = Depends(get_db)):
    layer = await db.scalar(select(CustomLayer).where(CustomLayer.id == layer_id))
    if not layer:
        raise HTTPException(404, "Layer not found")
    if body.name is not None:
        layer.name = body.name
    if body.style is not None:
        layer.style = body.style
    if body.visible is not None:
        layer.visible = body.visible
    await db.commit()
    await db.refresh(layer)
    return _to_response(layer)


@router.delete("/{layer_id}", status_code=204)
async def delete_layer(layer_id: int, db: AsyncSession = Depends(get_db)):
    layer = await db.scalar(select(CustomLayer).where(CustomLayer.id == layer_id))
    if not layer:
        raise HTTPException(404, "Layer not found")
    await db.delete(layer)
    await db.commit()
