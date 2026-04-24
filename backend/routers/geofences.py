from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.shape import from_shape, to_shape
from pydantic import BaseModel
from shapely.geometry import Polygon, mapping, shape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db
from db.models import Geofence

router = APIRouter(prefix="/geofences", tags=["geofences"])


class GeofencePayload(BaseModel):
    name: str
    description: Optional[str] = None
    zone_type: str = "alert"
    active: bool = True
    geojson_polygon: dict


class GeofenceResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    zone_type: str
    active: bool
    geojson_polygon: dict


def _to_response(fence: Geofence) -> GeofenceResponse:
    return GeofenceResponse(
        id=fence.id,
        name=fence.name,
        description=fence.description,
        zone_type=fence.zone_type,
        active=fence.active,
        geojson_polygon=mapping(to_shape(fence.geom)),
    )


def _parse_polygon(geojson: dict) -> Polygon:
    poly = shape(geojson)
    if not isinstance(poly, Polygon):
        raise HTTPException(400, "Geometry must be a Polygon")
    if not poly.is_valid:
        poly = poly.buffer(0)  # attempt repair
    if not poly.is_valid:
        raise HTTPException(400, "Invalid polygon geometry")
    return poly


@router.get("", response_model=list[GeofenceResponse])
async def list_geofences(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    q = select(Geofence)
    if not include_inactive:
        q = q.where(Geofence.active == True)  # noqa: E712
    result = await db.execute(q.order_by(Geofence.id))
    return [_to_response(f) for f in result.scalars().all()]


@router.post("", response_model=GeofenceResponse, status_code=201)
async def create_geofence(body: GeofencePayload, db: AsyncSession = Depends(get_db)):
    poly = _parse_polygon(body.geojson_polygon)
    fence = Geofence(
        name=body.name,
        description=body.description,
        zone_type=body.zone_type,
        active=body.active,
        geom=from_shape(poly, srid=4326),
    )
    db.add(fence)
    await db.commit()
    await db.refresh(fence)
    return _to_response(fence)


@router.put("/{fence_id}", response_model=GeofenceResponse)
async def update_geofence(
    fence_id: int, body: GeofencePayload, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Geofence).where(Geofence.id == fence_id))
    fence = result.scalar_one_or_none()
    if not fence:
        raise HTTPException(404, "Geofence not found")
    poly = _parse_polygon(body.geojson_polygon)
    fence.name = body.name
    fence.description = body.description
    fence.zone_type = body.zone_type
    fence.active = body.active
    fence.geom = from_shape(poly, srid=4326)
    await db.commit()
    await db.refresh(fence)
    return _to_response(fence)


@router.delete("/{fence_id}", status_code=204)
async def delete_geofence(fence_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Geofence).where(Geofence.id == fence_id))
    fence = result.scalar_one_or_none()
    if not fence:
        raise HTTPException(404, "Geofence not found")
    fence.active = False  # soft delete
    await db.commit()
