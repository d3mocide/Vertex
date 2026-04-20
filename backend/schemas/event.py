from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel


class EventSchema(BaseModel):
    event_id: str
    event_type: str
    entity_id: Optional[str] = None
    ts: datetime
    severity: str = "info"
    summary: str
    details: Optional[dict[str, Any]] = None

    class Config:
        from_attributes = True
