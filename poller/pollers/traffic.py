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
_ODOT_FLOW_PATH = "/TrafficDetector/Roadway"
_ODOT_INV_PATH = "/TrafficDetector/Inventory"


class TrafficPoller(BasePoller):
    name = "traffic"
    interval = 60
    _station_map = {}

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
            "User-Agent": "Vertex/0.1 (vertex; contact@localhost)",
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

            # 3. Fetch Roadway Flow
            try:
                # Refresh inventory occasionally (every 10 polls)
                if not self._station_map:
                    url = f"{_ODOT_API_BASE}{_ODOT_INV_PATH}"
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 200:
                        self._station_map = _parse_odot_inventory(resp.json())

                url = f"{_ODOT_API_BASE}{_ODOT_FLOW_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                await set_feed("traffic:flow", _parse_odot_flow(resp.json(), self._station_map))
            except Exception as exc:
                logger.warning("[traffic] flow fetch failed: %s", exc)


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

        # Filter by global bounding box to ensure consistency across tactical layers
        if not (settings.bbox_min_lat <= lat <= settings.bbox_max_lat and
                settings.bbox_min_lon <= lon <= settings.bbox_max_lon):
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


def _parse_odot_flow(data: dict, station_map: dict) -> list[dict]:
    """Normalize ODOT Traffic Detector response."""
    items: list[dict] = []
    records = data.get("detector-data-items", [])
    corridors = [c.strip() for c in settings.traffic_flow_corridors.split(",") if c.strip()]

    for rec in records:
        det_list = rec.get("detector-list", {})
        detail = det_list.get("detector-data-detail", {})

        sid = detail.get("station-id")
        if sid is None:
            continue

        meta = station_map.get(sid)
        if not meta:
            continue

        hwy = meta.get("road", "")
        loc = meta.get("loc", "")

        if not any(c in hwy for c in corridors):
            continue
        items.append({
            "id":    str(sid),
            "road":  hwy,
            "loc":   loc,
            "speed": detail.get("vehicle-speed"),
            "occ":   detail.get("vehicle-occupancy"),
            "vol":   detail.get("vehicle-count"),
            "lat":   meta.get("lat"),
            "lon":   meta.get("lon"),
        })
            
    return items


def _parse_odot_inventory(data: dict) -> dict:
    """Map station-id to location metadata."""
    mapping = {}
    stations = data.get("traffic-detector-list", [])
    for s in stations:
        loc = s.get("location", {})
        det = s.get("detector-station", {})
        sid = det.get("station-id")
        if sid is not None:
            mapping[sid] = {
                "road": loc.get("highway-name", ""),
                "loc":  loc.get("location-name", ""),
                "lat":  loc.get("latitude"),
                "lon":  loc.get("longitude"),
            }
    return mapping





