import json
from fastapi import APIRouter
from redis_bus import get_redis

router = APIRouter(prefix="/traffic", tags=["traffic"])


@router.get("/incidents")
async def get_incidents():
    raw = await get_redis().get("feed:traffic:incidents")
    return json.loads(raw) if raw else []


@router.get("/cameras")
async def get_cameras():
    raw = await get_redis().get("feed:traffic:cameras")
    return json.loads(raw) if raw else []


@router.get("/flow")
async def get_flow():
    raw = await get_redis().get("feed:traffic:flow")
    return json.loads(raw) if raw else []
