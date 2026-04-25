import asyncio
import logging
import httpx
from config import settings
from bus import publish_entity
from normalizers.aircraft import normalize_opensky, normalize_tar1090
from .base import BasePoller

logger = logging.getLogger(__name__)


def _ultrafeeder_url() -> str | None:
    """Return the tar1090 aircraft.json URL for a local/external ADS-B source."""
    return settings.adsb_url if settings.adsb_url else None


class AdsbPoller(BasePoller):
    name = "adsb"
    interval = 5

    async def setup(self):
        url = _ultrafeeder_url()
        if url:
            logger.info("[adsb] using local ultrafeeder at %s", url)
        else:
            logger.info("[adsb] no ultrafeeder configured — falling back to OpenSky")

    async def poll(self):
        url = _ultrafeeder_url()
        if url:
            await self._poll_ultrafeeder(url)
        else:
            await self._poll_opensky()

    async def _poll_ultrafeeder(self, url: str):
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"})
            resp.raise_for_status()
            data = resp.json()
        for ac in data.get("aircraft", []):
            entity = normalize_tar1090(ac)
            if entity:
                await publish_entity(entity)

    async def _poll_opensky(self):
        url = (
            "https://opensky-network.org/api/states/all"
            f"?lamin={settings.bbox_min_lat}&lamax={settings.bbox_max_lat}"
            f"&lomin={settings.bbox_min_lon}&lomax={settings.bbox_max_lon}"
        )
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url)
        if resp.status_code == 429:
            logger.warning("[adsb] OpenSky rate limited — backing off 60s")
            await asyncio.sleep(60)
            return
        resp.raise_for_status()
        data = resp.json()
        for state in data.get("states") or []:
            entity = normalize_opensky(state)
            if entity:
                await publish_entity(entity)

