from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class EntitySchema(BaseModel):
    entity_id: str
    entity_type: str
    source: str
    display_name: Optional[str] = None
    identity: Optional[dict[str, Any]] = None
    tags: Optional[list[str]] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None
    status: Optional[str] = None
    last_seen: Optional[datetime] = None

    class Config:
        from_attributes = True
