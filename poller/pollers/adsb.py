import asyncio
import logging
import httpx
from config import settings
from bus import publish_entity
from normalizers.aircraft import normalize_opensky, normalize_tar1090
from .base import BasePoller

logger = logging.getLogger(__name__)


class AdsbPoller(BasePoller):
    name = "adsb"
    interval = 5

    async def poll(self):
        if settings.ultrafeeder_host:
            await self._poll_ultrafeeder()
        else:
            await self._poll_opensky()

    async def _poll_ultrafeeder(self):
        url = f"http://{settings.ultrafeeder_host}:{settings.ultrafeeder_port}/tar1090/data/aircraft.json"
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url)
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
