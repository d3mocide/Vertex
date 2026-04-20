from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from redis_bus import get_all_entities, get_entity_state
from schemas.entity import EntitySchema

router = APIRouter(tags=["entities"])


@router.get("/entities", response_model=list[EntitySchema])
async def list_entities(entity_type: Optional[str] = Query(None)):
    return await get_all_entities(entity_type)


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: str):
    entity = await get_entity_state(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity
