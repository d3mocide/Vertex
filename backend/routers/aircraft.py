from fastapi import APIRouter
from redis_bus import get_aircraft_snapshot

router = APIRouter(tags=["aircraft"])


@router.get("/aircraft/snapshot")
async def get_aircraft_snapshot_route():
    snapshot = await get_aircraft_snapshot()
    if snapshot:
        return snapshot
    return {"now": None, "count": 0, "aircraft": [], "airports": {}}


@router.get("/aircraft/airports")
async def get_airports_route():
    snapshot = await get_aircraft_snapshot()
    if not snapshot:
        return {}
    return snapshot.get("airports") or {}
