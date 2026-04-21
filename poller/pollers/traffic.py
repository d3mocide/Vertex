import logging
import httpx
import math
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# ODOT TripCheck Data API — free, requires key from developer.odot.state.or.us
_ODOT_API_BASE = "https://api.odot.state.or.us/tripcheck"
_ODOT_INCIDENTS_PATH = "/Incidents"
_ODOT_CCTV_PATH = "/Cctv/Inventory"


class TrafficPoller(BasePoller):
    name = "traffic"
    interval = 300  # CCTV inventory doesn't change often

    async def setup(self):
        if not settings.odot_api_key:
            logger.warning(
                "[traffic] ODOT_API_KEY not set — traffic incidents/cameras disabled."
            )
        else:
            logger.info("[traffic] ODOT TripCheck API configured")

    async def poll(self):
        if not settings.odot_api_key:
            return

        headers = {
            "Ocp-Apim-Subscription-Key": settings.odot_api_key,
            "User-Agent": "CivicGrid/0.1 (civic-grid; contact@localhost)",
        }
        
        # Note: Inventory API doesn't use 'county' param, but Incidents does.
        # We'll filter manually for cameras to be safe.

        async with httpx.AsyncClient(timeout=15) as client:
            # 1. Fetch Incidents
            try:
                url = f"{_ODOT_API_BASE}{_ODOT_INCIDENTS_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                await set_feed("traffic:incidents", _parse_odot_incidents(resp.json()))
            except Exception as exc:
                logger.warning("[traffic] incidents fetch failed: %s", exc)

            # 2. Fetch CCTV Cameras
            try:
                url = f"{_ODOT_API_BASE}{_ODOT_CCTV_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                await set_feed("traffic:cameras", _parse_odot_cameras(resp.json()))
            except Exception as exc:
                logger.warning("[traffic] cctv fetch failed: %s", exc)


def _parse_odot_incidents(data: dict) -> list[dict]:
    """Normalize ODOT TripCheck API incident response."""
    items: list[dict] = []
    records = data.get("incidents", [])
    for inc in records:
        items.append({
            "title":       inc.get("incidentSubType", inc.get("incidentType", "")),
            "description": inc.get("locationDescription", inc.get("description", "")),
            "link":        "",
            "pubDate":     inc.get("startTime", ""),
            "lat":         inc.get("latitude"),
            "lon":         inc.get("longitude"),
            "severity":    inc.get("severity", ""),
        })
    return items


def _parse_odot_cameras(data: dict) -> list[dict]:
    """Normalize ODOT TripCheck API CCTV response with distance filtering."""
    items: list[dict] = []
    records = data.get("CCTVInventoryRequest", [])
    
    # Home location
    h_lat = settings.region_lat
    h_lon = settings.region_lon
    
    # 0.15 degrees is roughly 15-20km in Oregon
    # We'll use a slightly larger buffer for the 'metro' feel
    RADIUS_DEG = 0.15 

    for cam in records:
        lat = cam.get("latitude")
        lon = cam.get("longitude")
        
        if lat is None or lon is None:
            continue
            
        # Simple Euclidean distance check (degrees to km conversion)
        # 1 deg lat is ~111km. 1 deg lon at 45N is ~78km.
        # For simplicity in local radius, we'll use a mean of 100km per deg or just return the squared deg for sorting.
        # But let's actually return a rough KM for the UI.
        dy = (lat - h_lat) * 111.0
        dx = (lon - h_lon) * 78.0
        dist_km = math.sqrt(dx**2 + dy**2)

        if dist_km > 20.0: # Keep up to 20km in the bus, filter tighter in UI
            continue

        items.append({
            "id":      str(cam.get("device-id", "")),
            "name":    cam.get("device-name", ""),
            "url":     cam.get("cctv-url", ""),
            "ldi_url": cam.get("cctv-url", ""),
            "lat":     lat,
            "lon":     lon,
            "road":    cam.get("route-id", ""),
            "dist_km": round(dist_km, 2),
        })
    
    # Sort by distance
    items.sort(key=lambda x: x["dist_km"])
    return items





