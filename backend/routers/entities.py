from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from redis_bus import get_all_entities, get_entity_state
from schemas.entity import EntitySchema

router = APIRouter(tags=["entities"])


@router.get("/entities", response_model=list[EntitySchema])
async def list_entities(
    entity_type: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    bbox: Optional[str] = Query(
        None,
        description="Bounding box filter: min_lon,min_lat,max_lon,max_lat",
    ),
    region_id: Optional[str] = Query(None),
):
    entities = await get_all_entities(entity_type)

    if bbox:
        try:
            min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
            entities = [
                e for e in entities
                if (
                    e.get("lat") is not None
                    and e.get("lon") is not None
                    and min_lat <= e["lat"] <= max_lat
                    and min_lon <= e["lon"] <= max_lon
                )
            ]
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="bbox must be min_lon,min_lat,max_lon,max_lat")

    if region_id:
        entities = [e for e in entities if e.get("region_id") == region_id]

    return entities[offset : offset + limit]


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: str):
    entity = await get_entity_state(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity
