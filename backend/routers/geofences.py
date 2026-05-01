from typing import Literal, Optional
import math

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
    geofence_shape: Literal["polygon", "circle"] = "polygon"
    dwell_seconds: int = 0
    geojson_polygon: Optional[dict] = None
    center_lat: Optional[float] = None
    center_lon: Optional[float] = None
    radius_m: Optional[float] = None


class GeofenceResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    zone_type: str
    geofence_shape: str
    dwell_seconds: int
    center_lat: Optional[float] = None
    center_lon: Optional[float] = None
    radius_m: Optional[float] = None
    active: bool
    geojson_polygon: dict


def _to_response(fence: Geofence) -> GeofenceResponse:
    return GeofenceResponse(
        id=fence.id,
        name=fence.name,
        description=fence.description,
        zone_type=fence.zone_type,
        geofence_shape=fence.geofence_shape,
        dwell_seconds=fence.dwell_seconds,
        center_lat=fence.center_lat,
        center_lon=fence.center_lon,
        radius_m=fence.radius_m,
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


def _circle_to_polygon(center_lat: float, center_lon: float, radius_m: float, steps: int = 48) -> Polygon:
    if radius_m <= 0:
        raise HTTPException(400, "radius_m must be > 0")

    points: list[tuple[float, float]] = []
    lat_scale = 1 / 111_320.0
    lon_scale = 1 / max(111_320.0 * math.cos(math.radians(center_lat)), 1e-6)
    for i in range(steps):
        a = 2 * math.pi * (i / steps)
        d_lat = math.sin(a) * radius_m * lat_scale
        d_lon = math.cos(a) * radius_m * lon_scale
        points.append((center_lon + d_lon, center_lat + d_lat))
    points.append(points[0])
    return Polygon(points)


def _payload_to_polygon(body: GeofencePayload) -> Polygon:
    if body.dwell_seconds < 0:
        raise HTTPException(400, "dwell_seconds must be >= 0")
    if body.geofence_shape == "circle":
        if body.center_lat is None or body.center_lon is None or body.radius_m is None:
            raise HTTPException(400, "circle requires center_lat, center_lon, and radius_m")
        return _circle_to_polygon(body.center_lat, body.center_lon, body.radius_m)
    if not body.geojson_polygon:
        raise HTTPException(400, "geojson_polygon is required for polygon geofences")
    return _parse_polygon(body.geojson_polygon)


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
    poly = _payload_to_polygon(body)
    fence = Geofence(
        name=body.name,
        description=body.description,
        zone_type=body.zone_type,
        geofence_shape=body.geofence_shape,
        center_lat=body.center_lat,
        center_lon=body.center_lon,
        radius_m=body.radius_m,
        dwell_seconds=body.dwell_seconds,
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
    poly = _payload_to_polygon(body)
    fence.name = body.name
    fence.description = body.description
    fence.zone_type = body.zone_type
    fence.geofence_shape = body.geofence_shape
    fence.center_lat = body.center_lat
    fence.center_lon = body.center_lon
    fence.radius_m = body.radius_m
    fence.dwell_seconds = body.dwell_seconds
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
