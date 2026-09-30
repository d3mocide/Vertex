"""Washington road alerts and cameras from the documented, keyed Traveler API."""
import json
import logging
import math
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx

from bus import set_feed
from config import settings
from normalizers.beast_math import haversine_km
from arcgis import read_json
from .base import BasePoller
from .traffic import _clean, triage_incidents

logger = logging.getLogger(__name__)
BASE = "https://www.wsdot.wa.gov/traffic/api/"
ENDPOINTS = {
    "incidents": "HighwayAlerts/HighwayAlertsREST.svc/GetAlertsAsJson",
    "cameras": "HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson",
}


def _point(feature, region):
    geometry = feature.get("geometry") or {}
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    if geometry.get("type") != "Point" or not isinstance(coordinates, list) or len(coordinates) < 2:
        return None
    lon, lat = coordinates[:2]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (lat, lon)):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if not (region.bbox_min_lat <= lat <= region.bbox_max_lat and region.bbox_min_lon <= lon <= region.bbox_max_lon):
        return None
    return lat, lon, round(haversine_km(region.region_lat, region.region_lon, lat, lon), 2)


def _iso(value):
    if value is None:
        return ""
    try:
        match = re.fullmatch(r"/Date\((-?\d+)(?:[+-]\d{4})?\)/", str(value))
        if match:
            return datetime.fromtimestamp(int(match[1]) / 1000, timezone.utc).isoformat()
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        # Only accept timestamps with an explicit offset; never guess the publisher's timezone.
        return dt.astimezone(timezone.utc).isoformat() if dt.tzinfo else ""
    except (TypeError, ValueError, OverflowError, OSError):
        return ""


def _location(p, key):
    location = p.get(key)
    if not isinstance(location, dict):
        return {}
    return {"geometry": {"type": "Point", "coordinates": [location.get("Longitude"), location.get("Latitude")]}}


def normalize_incidents(records, region):
    items = []
    for p in records:
        if str(p.get("EventStatus") or "").lower() == "closed":
            continue  # A closed alert is not a road closure.
        point = _point(_location(p, "StartRoadwayLocation"), region) or _point(_location(p, "EndRoadwayLocation"), region)
        if point is None or p.get("AlertID") is None:
            continue
        lat, lon, distance = point
        road = p.get("StartRoadwayLocation") or {}
        title = _clean(str(p.get("HeadlineDescription") or "Road alert"))
        items.append({"id": f"wsdot-travel:{p['AlertID']}", "title": title,
            "description": _clean(str(p.get("ExtendedDescription") or title)),
            "location": " ".join(str(road.get(k) or "") for k in ("RoadName", "Direction")).strip(),
            "link": "https://wsdot.com/travel/real-time/map/", "pubDate": _iso(p.get("LastUpdatedTime")),
            "start": _iso(p.get("StartTime")), "sched_end": _iso(p.get("EndTime")),
            "lat": lat, "lon": lon, "dist_km": distance, "severity": str(p.get("Priority") or ""),
            "event": str(p.get("EventCategory") or ""), "event_sub": "", "ramp": False})
    return triage_incidents(sorted(items, key=lambda item: item["dist_km"]))


def normalize_cameras(records, region):
    items = []
    for p in records:
        point = _point(_location(p, "CameraLocation"), region)
        url = p.get("ImageURL")
        if point is None or p.get("CameraID") is None or not isinstance(url, str) or p.get("IsActive") is False:
            continue
        try:
            parsed = urlsplit(url)
            host = parsed.hostname or ""
            if parsed.scheme not in {"http", "https"} or parsed.username is not None or parsed.password is not None:
                continue
            if not any(host == suffix or host.endswith("." + suffix) for suffix in ("wsdot.wa.gov", "wsdot.com", "tripcheck.com")):
                continue
        except ValueError:
            continue
        lat, lon, distance = point
        name = str(p.get("Title") or "WSDOT camera")
        items.append({"id": f"wsdot-travel:{p['CameraID']}", "name": name, "url": url,
            "lat": lat, "lon": lon, "road": name.split(" at ")[0], "dist_km": distance,
            "health": "unknown", "last_ok_ts": None})
    return sorted(items, key=lambda item: item["dist_km"])


async def fetch_layer(client, kind, region):
    key = getattr(region, "wsdot_api_key", "")
    if not key:
        raise ValueError("WSDOT_API_KEY is required")
    data = await read_json(client, BASE + ENDPOINTS[kind], params={"AccessCode": key})
    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        raise ValueError("WSDOT did not return a record array")
    return data


class WsdotPoller(BasePoller):
    name = "wsdot"
    interval = 60

    def __init__(self):
        self._tick = 0

    async def poll(self):
        kinds = ["incidents"]
        if self._tick % 5 == 0:
            kinds.append("cameras")
        self._tick += 1
        successes = 0
        async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "Vertex/1.0"}) as client:
            for kind in kinds:
                try:
                    features = await fetch_layer(client, kind, settings)
                    normalizer = normalize_incidents if kind == "incidents" else normalize_cameras
                    await set_feed("traffic:" + kind, normalizer(features, settings), provider_id="wsdot-travel")
                    successes += 1
                except (httpx.HTTPError, ValueError) as exc:
                    logger.warning("[wsdot] %s fetch failed (%s)", kind, type(exc).__name__)
        if not successes:
            raise RuntimeError("WSDOT travel endpoints did not produce data")
