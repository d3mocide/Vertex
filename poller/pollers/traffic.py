import ipaddress
import logging
import httpx
from urllib.parse import urlparse
from config import settings
from bus import set_feed
from normalizers.beast_math import haversine_km
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

    def __init__(self):
        self._station_map: dict = {}

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
                cameras = _parse_odot_cameras(resp.json())
                await _check_camera_health(cameras)
                await set_feed("traffic:cameras", cameras)
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
    """Normalize ODOT TripCheck API incident response.

    Supports both legacy flat keys and current nested hyphenated keys.
    """
    items: list[dict] = []
    h_lat = settings.region_lat
    h_lon = settings.region_lon
    records = data.get("incidents", []) if isinstance(data, dict) else (data or [])
    for inc in records:
        # ODOT currently returns is-active as "true"/"false" strings.
        active = inc.get("is-active")
        if isinstance(active, str) and active.lower() != "true":
            continue
        if isinstance(active, bool) and not active:
            continue

        loc = inc.get("location") or {}
        start_loc = loc.get("start-location") or {}
        end_loc = loc.get("end-location") or {}

        lat = _first_number(
            inc.get("latitude"),
            start_loc.get("start-lat"),
            end_loc.get("end-lat"),
        )
        lon = _first_number(
            inc.get("longitude"),
            start_loc.get("start-long"),
            end_loc.get("end-long"),
        )

        # Keep incidents local to the configured operating region.
        if lat is not None and lon is not None:
            if not (
                settings.bbox_min_lat <= lat <= settings.bbox_max_lat
                and settings.bbox_min_lon <= lon <= settings.bbox_max_lon
            ):
                continue
        else:
            # Incidents without usable coordinates cannot be region-scoped reliably.
            continue

        location = (
            start_loc.get("location-desc")
            or loc.get("location-name")
            or inc.get("locationDescription", "")
        )

        title = (
            inc.get("headline")
            or inc.get("incidentSubType")
            or inc.get("incidentType")
            or inc.get("impact-desc")
            or "Traffic incident"
        )
        description = inc.get("comments") or inc.get("description") or location
        severity = inc.get("impact-desc") or inc.get("severity", "")

        route = loc.get("route-id") or ""
        direction = loc.get("direction") or ""
        if route and direction and location:
            location = f"{route} {direction} - {location}"
        elif route and location:
            location = f"{route} - {location}"

        items.append({
            "title":       title,
            "description": description,
            "location":    location,
            "link":        inc.get("info-url", ""),
            "pubDate":     inc.get("update-time", inc.get("create-time", inc.get("startTime", ""))),
            "lat":         lat,
            "lon":         lon,
            "severity":    severity,
            "dist_km":     round(_distance_km(h_lat, h_lon, lat, lon), 2),
        })

    # Keep nearest incidents at the top, consistent with camera ordering.
    items.sort(key=lambda x: x.get("dist_km", float("inf")))
    return items


def _first_number(*values):
    for value in values:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _distance_km(h_lat: float, h_lon: float, lat: float, lon: float) -> float:
    return haversine_km(h_lat, h_lon, lat, lon)


def _parse_odot_cameras(data: dict) -> list[dict]:
    """Normalize ODOT TripCheck API CCTV response with distance filtering."""
    items: list[dict] = []
    records = data.get("CCTVInventoryRequest", [])
    
    # Home location
    h_lat = settings.region_lat
    h_lon = settings.region_lon
    
    for cam in records:
        lat = cam.get("latitude")
        lon = cam.get("longitude")
        
        if lat is None or lon is None:
            continue
            
        dist_km = haversine_km(h_lat, h_lon, lat, lon)

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

        found = False
        for c in corridors:
            if c in hwy:
                found = True
                break

        if not found:
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


def _is_public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        try:
            ip = ipaddress.ip_address(hostname)
            return ip.is_global
        except ValueError:
            pass  # hostname, not IP literal — DNS not pre-resolved on Pi
        return bool(hostname)
    except Exception:
        return False


async def _check_camera_health(cameras: list[dict]) -> None:
    """HEAD-check each camera URL and annotate with health status + last_ok_ts.

    Health values: ``"ok"`` (200–399), ``"warn"`` (4xx), ``"down"`` (error/timeout).
    Runs all checks concurrently with a short per-request timeout.
    """
    import asyncio
    import time

    async def _probe(cam: dict) -> None:
        url = cam.get("url", "")
        if not url or not _is_public_url(url):
            cam["health"] = "unknown"
            cam["last_ok_ts"] = None
            return
        try:
            async with httpx.AsyncClient(timeout=4) as hc:
                r = await hc.head(url)
            if r.status_code < 400:
                cam["health"] = "ok"
                cam["last_ok_ts"] = int(time.time())
            else:
                cam["health"] = "warn"
                cam["last_ok_ts"] = None
        except Exception:
            cam["health"] = "down"
            cam["last_ok_ts"] = None

    await asyncio.gather(*[_probe(cam) for cam in cameras])

