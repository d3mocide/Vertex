import logging
import math
from datetime import datetime, timezone

import httpx

from bus import publish_entity
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_DEFAULT_FIRE_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires"


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _in_region_bbox(lat: float, lon: float) -> bool:
    return (
        settings.bbox_min_lat <= lat <= settings.bbox_max_lat
        and settings.bbox_min_lon <= lon <= settings.bbox_max_lon
    )


def _latest_geometry(event: dict) -> dict | None:
    geos = event.get("geometry") or []
    if not geos:
        return None
    latest = geos[-1]
    return latest if isinstance(latest, dict) else None


def _parse_iso8601(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _latest_lon_lat(event: dict) -> tuple[float, float] | None:
    latest = _latest_geometry(event)
    if not latest:
        return None
    coords = latest.get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None

    # EONET may return Point [lon, lat] or Polygon [[[lon,lat],...],...]
    if isinstance(coords[0], (int, float)) and isinstance(coords[1], (int, float)):
        return float(coords[0]), float(coords[1])

    if isinstance(coords[0], list) and coords and isinstance(coords[0][0], list):
        ring = coords[0]
        if not ring:
            return None
        lon = sum(p[0] for p in ring if isinstance(p, list) and len(p) >= 2) / len(ring)
        lat = sum(p[1] for p in ring if isinstance(p, list) and len(p) >= 2) / len(ring)
        return float(lon), float(lat)

    return None


def _latest_event_ts(event: dict) -> datetime | None:
    latest = _latest_geometry(event)
    if latest:
        geo_ts = _parse_iso8601(latest.get("date"))
        if geo_ts:
            return geo_ts

    return _parse_iso8601(event.get("closed"))


def _classify_relevance(lat: float, lon: float, event_ts: datetime | None) -> tuple[str | None, float]:
    distance_km = _distance_km(settings.region_lat, settings.region_lon, lat, lon)
    if _in_region_bbox(lat, lon) or distance_km <= settings.fire_alert_radius_km:
        return "local", distance_km

    if distance_km > settings.fire_regional_radius_km:
        return None, distance_km

    if event_ts is not None:
        age_hours = (datetime.now(timezone.utc) - event_ts).total_seconds() / 3600
        if age_hours > settings.fire_regional_recent_hours:
            return None, distance_km

    return "regional", distance_km


class FirePoller(BasePoller):
    name = "fire"
    interval = 600

    def __init__(self):
        self._source_urls: list[str] = []

    async def setup(self):
        from db import get_pool

        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'fire' AND enabled = TRUE"
        )
        self._source_urls = [r["url"] for r in rows if r.get("url")]
        if not self._source_urls:
            self._source_urls = [_DEFAULT_FIRE_URL]
            logger.info("[fire] no fire source configured; using default EONET feed")
        else:
            logger.info("[fire] %d source(s) configured", len(self._source_urls))

    async def poll(self):
        for url in self._source_urls:
            try:
                await self._poll_source(url)
            except Exception as exc:
                logger.warning("[fire] source failed (%s): %s", url, exc)

    async def _poll_source(self, url: str):
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            payload = resp.json()

        events = payload.get("events") if isinstance(payload, dict) else None
        if not isinstance(events, list):
            return

        count = 0
        dropped = 0
        for ev in events:
            event_id = ev.get("id")
            title = ev.get("title") or "Wildfire"
            if not event_id:
                continue

            lon_lat = _latest_lon_lat(ev)
            if not lon_lat:
                continue
            lon, lat = lon_lat
            event_ts = _latest_event_ts(ev)
            relevance, distance_km = _classify_relevance(lat, lon, event_ts)
            if relevance is None:
                dropped += 1
                continue

            entity = {
                "entity_id": f"fire:{event_id}",
                "entity_type": "fire_incident",
                "source": "fire",
                "display_name": str(title),
                "lat": lat,
                "lon": lon,
                "altitude": None,
                "heading": None,
                "speed": None,
                "status": "active",
                "distance_km": round(distance_km, 2),
                "last_seen": event_ts.isoformat() if event_ts else None,
                "identity": {
                    "provider": "EONET",
                    "event_id": event_id,
                    "link": ev.get("link"),
                    "relevance": relevance,
                    "distance_km": round(distance_km, 2),
                    "event_ts": event_ts.isoformat() if event_ts else None,
                    "categories": [c.get("id") for c in (ev.get("categories") or []) if isinstance(c, dict)],
                },
                "tags": ["fire_incident", f"fire_{relevance}"],
            }
            await publish_entity(entity, ttl=3600)
            count += 1

        if count:
            logger.info("[fire] published %d wildfire entities (%d filtered out)", count, dropped)
