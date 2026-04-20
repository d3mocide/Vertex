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
