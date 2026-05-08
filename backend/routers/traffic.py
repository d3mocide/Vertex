import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/traffic", tags=["traffic"])


def _safe_json(raw: str | None) -> list:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


@router.get("/incidents")
async def get_incidents():
    return _safe_json(await get_redis().get("feed:traffic:incidents"))


@router.get("/cameras")
async def get_cameras():
    return _safe_json(await get_redis().get("feed:traffic:cameras"))


@router.get("/flow")
async def get_flow():
    return _safe_json(await get_redis().get("feed:traffic:flow"))
