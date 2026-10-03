import asyncio
import json
import logging
import websockets
from config import settings, load_regions
from bus import publish_entity
from normalizers.vessel import normalize_aisstream, normalize_ais_catcher, seed_static_cache
from .base import BasePoller
from redaction import redact_text, redact_url
from security import validate_safe_url

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10


def _as_dict(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


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
        self._local_urls = []
        for row in rows:
            try:
                await validate_safe_url(row["url"], allowed_schemes={"ws", "wss"})
                self._local_urls.append(row["url"])
            except ValueError as exc:
                logger.warning("[ais] blocked unsafe source %s: %s", redact_url(row["url"]), exc)
        if self._local_urls:
            logger.info("[ais] %d local source(s) configured", len(self._local_urls))
        elif settings.aisstream_api_key:
            logger.info("[ais] no local sources — will use AISstream.io fallback")
        else:
            logger.warning("[ais] no AIS source configured — poller inactive")
        try:
            vessels = await get_pool().fetch(
                "SELECT entity_id, identity FROM entities WHERE entity_type = 'vessel' AND last_seen > NOW() - INTERVAL '30 days'"
                " AND identity::jsonb ? 'ship_type_code'"
            )
            seeded = seed_static_cache((r["entity_id"].split(":", 1)[-1], _as_dict(r["identity"])) for r in vessels)
            logger.info("[ais] restored static data for %d vessel(s) from the database", seeded)
        except Exception as exc:  # the stream still fills the cache; this only saves the wait
            logger.warning("[ais] could not restore vessel static data: %s", exc)

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
        logger.info("[ais] connecting to local AIS-catcher at %s", redact_url(url))
        while True:
            try:
                async with websockets.connect(url) as ws, self.streaming():
                    async for raw in ws:
                        entity = normalize_ais_catcher(json.loads(raw))
                        if entity:
                            await publish_entity(entity)
            except Exception as exc:
                logger.error("[ais] ais-catcher error (%s): %s — retrying in %ds", redact_url(url), redact_text(exc), _RETRY_DELAY)
                await self._heartbeat("error", str(exc)[:256])
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
            "FilterMessageTypes": ["PositionReport", "ShipStaticData", "StaticDataReport", "StandardClassBPositionReport"],
        })
        logger.info("[ais] connecting to AISstream.io")
        while True:
            try:
                async with websockets.connect("wss://stream.aisstream.io/v0/stream") as ws, self.streaming():
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
