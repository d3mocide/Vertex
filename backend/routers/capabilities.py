from datetime import datetime, timezone

from fastapi import APIRouter

import capabilities
from config import settings
from redis_bus import get_redis

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
async def get_capabilities():
    """Which regional data contracts have a working provider, so the UI can hide what nothing feeds."""
    return capabilities.build(settings, await _feed_ages())
