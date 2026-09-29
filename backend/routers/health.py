from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(tags=["ops"])


@router.get("/health")
async def health():
    try:
        await get_redis().ping()
        redis_ok = True
    except Exception:
        redis_ok = False
    return {"status": "ok", "redis": redis_ok}


# Feeds the UI shows, with the age after which they count as stale (≈3 missed
# poll cycles). Feeds that only publish on change (radio:active, mesh:status,
# lightning) are reported without a threshold.
_FEED_MAX_AGE_S = {
    "weather:current": 900, "weather:stations": 900, "weather:rwis": 1500, "fire:hotspots": 2700, "fire:danger": 5400, "weather:alerts": 300, "weather:nwws_products": 5400,
    "traffic:incidents": 600, "traffic:flow": 600, "traffic:cameras": 3600,
    "utility:oregon": 1200, "utility:pge": 1200,
    "alerts:flash": 300, "news:local": 900, "intel:alerts": 900,
    "fire:perimeters": 5400, "radio:incidents": 600, "summary:latest": 7200,
    "hydro:status": 1800,
}


@router.get("/health/feeds")
async def feed_health():
    """Last-update time, age and staleness of every data feed (set by the poller)."""
    from datetime import datetime, timezone
    from redis_bus import get_redis

    raw = await get_redis().hgetall("feed:meta")
    now = datetime.now(timezone.utc)
    out = {}
    for key, ts in raw.items():
        key = key.decode() if isinstance(key, bytes) else key
        ts = ts.decode() if isinstance(ts, bytes) else ts
        try:
            age = (now - datetime.fromisoformat(ts)).total_seconds()
        except ValueError:
            continue
        max_age = _FEED_MAX_AGE_S.get(key)
        out[key] = {"ts": ts, "age_s": round(age), "max_age_s": max_age,
                    "stale": bool(max_age and age > max_age)}
    return out
