import logging
import httpx
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# ODOT TripCheck Data API — free, requires key from developer.odot.state.or.us
_ODOT_API_BASE = "https://api.odot.state.or.us/tripcheck/v1"
_ODOT_INCIDENTS_PATH = "/incidents"


class TrafficPoller(BasePoller):
    name = "traffic"
    interval = 60  # ODOT API recommends no faster than 60s

    async def setup(self):
        if not settings.odot_api_key:
            logger.warning(
                "[traffic] ODOT_API_KEY not set — traffic incidents disabled. "
                "Register free at https://developer.odot.state.or.us to get a key."
            )
        else:
            logger.info("[traffic] ODOT TripCheck API configured")

    async def poll(self):
        if not settings.odot_api_key:
            return  # Already warned at startup, suppress per-poll noise

        try:
            url = f"{_ODOT_API_BASE}{_ODOT_INCIDENTS_PATH}"
            headers = {
                "Ocp-Apim-Subscription-Key": settings.odot_api_key,
                "User-Agent": "CivicGrid/0.1 (civic-grid; contact@localhost)",
            }
            params = {
                "format": "json",
                "county": "Washington,Multnomah,Clackamas",
            }
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers=headers, params=params)
                resp.raise_for_status()
            await set_feed("traffic:incidents", _parse_odot(resp.json()))
        except Exception as exc:
            logger.warning("[traffic] incidents fetch failed: %s", exc)


def _parse_odot(data: dict | list) -> list[dict]:
    """Normalize ODOT TripCheck API incident response to our feed schema."""
    items: list[dict] = []
    # The API returns either a list directly or a dict with an 'incidents' key
    records = data if isinstance(data, list) else data.get("incidents", [])
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

