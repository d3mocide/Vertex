from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ObservationSchema(BaseModel):
    entity_id: str
    ts: datetime
    lat: Optional[float] = None
    lon: Optional[float] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None
    vertical_rate: Optional[float] = None
    status: Optional[str] = None
    signal_quality: Optional[float] = None
    raw_payload: Optional[dict] = None

    class Config:
        from_attributes = True
