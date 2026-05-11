from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/config", tags=["config"])


class RegionBboxOut(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


class RegionOut(BaseModel):
    id: str
    name: str
    bbox: RegionBboxOut
    enabled: bool
    show_on_map: bool = True


@router.get("/regions", response_model=list[RegionOut])
async def get_regions():
    """Return the list of configured monitoring regions."""
    import yaml, os
    sources_path = os.environ.get("SOURCES_YML", "/config/sources.yml")
    try:
        with open(sources_path) as f:
            data = yaml.safe_load(f) or {}
        raw = data.get("regions") or []
        # Support default show_on_map=True if missing in YAML
        return [RegionOut(**{**r, "show_on_map": r.get("show_on_map", True)}) for r in raw]
    except (FileNotFoundError, Exception):
        pass
    # Fallback: single region from backend config
    from config import settings
    return [RegionOut(
        id="default",
        name=getattr(settings, "region_name", "Default"),
        bbox=RegionBboxOut(
            min_lat=settings.bbox_min_lat,
            max_lat=settings.bbox_max_lat,
            min_lon=settings.bbox_min_lon,
            max_lon=settings.bbox_max_lon,
        ),
        enabled=True,
        show_on_map=True,
    )]
