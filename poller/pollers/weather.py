import asyncio
import logging
import httpx
from config import settings
from bus import set_feed
from normalizers.weather import normalize_observation, normalize_alerts
from .base import BasePoller

logger = logging.getLogger(__name__)

NWS_BASE = "https://api.weather.gov"
_HEADERS = {"User-Agent": "CivicGrid/0.1 (civic-grid; contact@localhost)"}


class WeatherPoller(BasePoller):
    name = "weather"
    interval = 300  # 5 minutes

    async def poll(self):
        await asyncio.gather(
            self._poll_observation(),
            self._poll_alerts(),
        )

    async def _poll_observation(self):
        url = f"{NWS_BASE}/stations/{settings.nws_station_primary}/observations/latest"
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        await set_feed("weather:current", normalize_observation(resp.json()))

    async def _poll_alerts(self):
        url = f"{NWS_BASE}/alerts/active?zone={settings.nws_zone}"
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            resp = await client.get(url)
            resp.raise_for_status()
        await set_feed("weather:alerts", normalize_alerts(resp.json()))
