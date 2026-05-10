import asyncio
import json
import logging
import websockets
from config import settings, load_regions
from bus import publish_entity
from normalizers.vessel import normalize_aisstream, normalize_ais_catcher
from .base import BasePoller

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10


class AisPoller(BasePoller):
    name = "ais"
    interval = 10

    def __init__(self):
        self._local_urls: list[str] = []

    async def poll(self):
        pass  # streaming pollers override run()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'ais' AND enabled = TRUE"
        )
        self._local_urls = [row["url"] for row in rows]
        if self._local_urls:
            logger.info("[ais] %d local source(s): %s", len(self._local_urls), self._local_urls)
        elif settings.aisstream_api_key:
            logger.info("[ais] no local sources — will use AISstream.io fallback")
        else:
            logger.warning("[ais] no AIS source configured — poller inactive")

    async def run(self):
        await self.setup()
        if self._local_urls:
            await asyncio.gather(*[
                asyncio.create_task(self._run_ais_catcher(url))
                for url in self._local_urls
            ])
        elif settings.aisstream_api_key:
            await self._run_aisstream()
        else:
            logger.warning("[ais] no AIS source configured — poller inactive")

    async def _run_ais_catcher(self, url: str):
        logger.info("[ais] connecting to local AIS-catcher at %s", url)
        while True:
            try:
                async with websockets.connect(url) as ws:
                    async for raw in ws:
                        entity = normalize_ais_catcher(json.loads(raw))
                        if entity:
                            await publish_entity(entity)
            except Exception as exc:
                logger.error("[ais] ais-catcher error (%s): %s — retrying in %ds", url, exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)

    async def _run_aisstream(self):
        regions = load_regions()
        if regions:
            bboxes = [
                [
                    [r.bbox.min_lat, r.bbox.min_lon],
                    [r.bbox.max_lat, r.bbox.max_lon],
                ]
                for r in regions
            ]
        else:
            bboxes = [
                [
                    [settings.bbox_min_lat, settings.bbox_min_lon],
                    [settings.bbox_max_lat, settings.bbox_max_lon],
                ]
            ]
        sub = json.dumps({
            "APIKey": settings.aisstream_api_key,
            "BoundingBoxes": bboxes,
            "FilterMessageTypes": ["PositionReport", "ShipStaticData", "StandardClassBPositionReport"],
        })
        logger.info("[ais] connecting to AISstream.io")
        while True:
            try:
                async with websockets.connect("wss://stream.aisstream.io/v0/stream") as ws:
                    await ws.send(sub)
                    async for raw in ws:
                        entity = normalize_aisstream(json.loads(raw))
                        if entity:
                            await publish_entity(entity)
            except Exception as exc:
                exc_msg = str(exc)
                if settings.aisstream_api_key and settings.aisstream_api_key in exc_msg:
                    exc_msg = exc_msg.replace(settings.aisstream_api_key, "***")
                logger.error("[ais] aisstream error: %s — retrying in %ds", exc_msg, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)
