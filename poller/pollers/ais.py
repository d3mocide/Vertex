import asyncio
import json
import logging
import websockets
from config import settings
from bus import publish_entity
from normalizers.vessel import normalize_aisstream, normalize_ais_catcher
from .base import BasePoller

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10


class AisPoller(BasePoller):
    name = "ais"
    interval = 10

    async def poll(self):
        pass  # streaming pollers override run()

    async def run(self):
        if settings.ais_catcher_url:
            await self._run_ais_catcher()
        elif settings.aisstream_api_key:
            await self._run_aisstream()
        else:
            logger.warning("[ais] no AIS source configured — poller inactive")

    async def _run_ais_catcher(self):
        url = settings.ais_catcher_url
        logger.info("[ais] connecting to local AIS-catcher at %s", url)
        while True:
            try:
                async with websockets.connect(url) as ws:
                    async for raw in ws:
                        entity = normalize_ais_catcher(json.loads(raw))
                        if entity:
                            await publish_entity(entity)
            except Exception as exc:
                logger.error("[ais] ais-catcher error: %s — retrying in %ds", exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)

    async def _run_aisstream(self):
        bbox = [
            [settings.bbox_min_lat, settings.bbox_min_lon],
            [settings.bbox_max_lat, settings.bbox_max_lon],
        ]
        sub = json.dumps({
            "APIKey": settings.aisstream_api_key,
            "BoundingBoxes": [bbox],
            "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
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
                logger.error("[ais] aisstream error: %s — retrying in %ds", exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)
