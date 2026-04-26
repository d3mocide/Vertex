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

    def __init__(self):
        self._source_urls: list[str] = []

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'adsb' AND enabled = TRUE"
        )
        self._source_urls = [row["url"] for row in rows]
        if self._source_urls:
            logger.info("[adsb] %d local source(s): %s", len(self._source_urls), self._source_urls)
        else:
            logger.info("[adsb] no local sources configured — falling back to OpenSky")

    async def poll(self):
        if self._source_urls:
            for url in self._source_urls:
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
