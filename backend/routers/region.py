from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

import nws_resolver
import pack_registry
import region_config
from config import settings
from db.models import AppSetting
from deps import get_db

router = APIRouter(prefix="/config/region", tags=["config"])


class RegionIn(BaseModel):
    name: str
    lat: float
    lon: float
    radius_km: float | None = None
    bbox: dict | None = None
    timezone: str
    nws: dict | None = None
    pack: str | None = None   # an installed pack id, or "none" for core feeds only


class ResolveIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


async def load_stored(db: AsyncSession) -> tuple[dict | None, str | None]:
    """The region saved in the database and when, or (None, None)."""
    # populate_existing: after a commit the session's copy is expired; re-read instead of lazy-loading.
    row = await db.get(AppSetting, region_config.REGION_KEY, populate_existing=True)
    if not row:
        return None, None
    return row.value, (row.updated_at.isoformat() if row.updated_at else None)


async def load_effective(db: AsyncSession) -> dict:
    """The region in force now: environment, else the database, else built-in defaults."""
    stored, updated = await load_stored(db)
    return region_config.effective(settings, stored, updated)


@router.get("")
async def get_region(db: AsyncSession = Depends(get_db)):
    """The operator's region (map center, name, bounding box, timezone) and where it came from."""
    return await load_effective(db)


@router.put("")
async def set_region(body: RegionIn, db: AsyncSession = Depends(get_db)):
    """Choose the region in the app. Admin only (enforced for every write by the auth middleware)."""
    locked_by = region_config.env_locked_by(settings)
    if locked_by:
        raise HTTPException(
            status_code=409,
            detail=f"The region is set by {', '.join(locked_by)} in the environment. "
                   "Remove them from .env and restart to manage it here.",
        )
    try:
        stored = region_config.normalize(body.model_dump(exclude_none=True))
    except region_config.RegionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    pack = stored.get("pack")
    if pack and pack != region_config.NO_PACK and pack not in pack_registry.valid_by_id():
        raise HTTPException(status_code=422, detail=f"pack {pack!r} is not installed (or is invalid)")
    row = await db.get(AppSetting, region_config.REGION_KEY)
    if row:
        row.value = stored
    else:
        db.add(AppSetting(key=region_config.REGION_KEY, value=stored))
    await db.commit()
    return await load_effective(db)


@router.post("/resolve")
async def resolve_region(body: ResolveIn):
    """Suggest NWS office, zones, timezone and a name for a location. Does not save anything.

    POST, so the auth middleware would ordinarily require admin: that is intended, since it drives the
    setup flow.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            return await nws_resolver.resolve(body.lat, body.lon, client)
        except nws_resolver.ResolveError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
