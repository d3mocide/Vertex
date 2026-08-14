import asyncio
import json
import logging

import httpx

from bus import get_bus
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_REDIS_KEY = "cache:rail:tracks"
_CACHE_TTL_S = 86_400  # 24 hours


def _build_query(bbox: str) -> str:
    """Build Overpass QL query for railway lines within a bounding box."""
    return (
        f"[out:json][timeout:90][maxsize:104857600];"
        f"("
        f'way["railway"~"^(rail|light_rail)$"]({bbox});'
        f");"
        f"out geom;"
    )


def _to_geojson(elements: list[dict]) -> dict:
    """Convert Overpass elements with geometry to a GeoJSON FeatureCollection."""
    features = []
    for el in elements:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        coords = [[pt["lon"], pt["lat"]] for pt in geom]
        tags = el.get("tags") or {}
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "osm_id": el.get("id"),
                "railway": tags.get("railway"),
                "name": tags.get("name") or tags.get("operator"),
                "maxspeed": tags.get("maxspeed"),
                "electrified": tags.get("electrified"),
            },
        })
    return {"type": "FeatureCollection", "features": features}


class RailInfrastructurePoller(BasePoller):
    """Periodically fetches OSM rail tracks for all configured regions and caches in Redis."""

    name = "rail_infrastructure"
    interval = 43200  # Poll every 12 hours (infrastructure changes very rarely)

    async def setup(self):
        # Trigger an immediate poll on startup if the cache is cold
        asyncio.create_task(self.poll())

    async def poll(self):
        logger.info("[rail_infra] starting OSM rail tracks refresh")
        
        # Calculate a bounding box that covers all enabled regions
        regions = settings.regions
        if not regions:
            logger.warning("[rail_infra] no regions configured, skipping poll")
            return

        min_lat = min(r.bbox.min_lat for r in regions)
        max_lat = max(r.bbox.max_lat for r in regions)
        min_lon = min(r.bbox.min_lon for r in regions)
        max_lon = max(r.bbox.max_lon for r in regions)
        
        # Overpass bbox format: south,west,north,east
        bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
        query = _build_query(bbox_str)

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    _OVERPASS_URL,
                    content=f"data={query}",
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                
            geojson = _to_geojson(data.get("elements", []))
            count = len(geojson["features"])
            
            r = await get_bus()
            await r.set(_REDIS_KEY, json.dumps(geojson), ex=_CACHE_TTL_S + 3600)
            logger.info("[rail_infra] cached %d rail track segments (bbox: %s)", count, bbox_str)
            
        except Exception as exc:
            logger.warning("[rail_infra] OSM fetch failed: %s", exc)
