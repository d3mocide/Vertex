from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

import capabilities
import pack_registry
from config import settings
from deps import get_db
from redis_bus import get_redis
from routers.region import load_effective

router = APIRouter(tags=["ops"])


async def _feed_ages() -> dict[str, float]:
    """Seconds since each feed last produced data (the poller writes feed:meta)."""
    raw = await get_redis().hgetall("feed:meta")
    now = datetime.now(timezone.utc)
    ages: dict[str, float] = {}
    for key, ts in raw.items():
        key = key.decode() if isinstance(key, bytes) else key
        ts = ts.decode() if isinstance(ts, bytes) else ts
        try:
            ages[key] = (now - datetime.fromisoformat(ts)).total_seconds()
        except ValueError:
            continue
    return ages


@router.get("/capabilities")
async def get_capabilities(db: AsyncSession = Depends(get_db)):
    """Which regional data contracts have a working provider, so the UI can hide what nothing feeds."""
    return capabilities.build(settings, await _feed_ages(), await load_effective(db), pack_registry.valid_by_id())
