"""
MeshCore poller — subscribes to one or more MeshCore bridge WebSocket endpoints
and normalises node updates into the canonical Entity model.
"""

import asyncio
import json
import logging

import websockets

from bus import publish_entity
from normalizers.mesh_node import normalize_mesh_node
from .base import BasePoller

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10


class MeshCorePoller(BasePoller):
    name = "meshcore"
    interval = 10

    def __init__(self):
        self._urls: list[str] = []

    async def poll(self):
        pass  # streaming — overrides run()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'meshcore' AND enabled = TRUE"
        )
        self._urls = [row["url"] for row in rows]
        if self._urls:
            logger.info("[meshcore] %d source(s): %s", len(self._urls), self._urls)
        else:
            logger.warning("[meshcore] no MeshCore source configured — poller inactive")

    async def run(self):
        await self.setup()
        if not self._urls:
            return
        await asyncio.gather(*[
            asyncio.create_task(self._run_source(url))
            for url in self._urls
        ])

    async def _run_source(self, url: str):
        logger.info("[meshcore] connecting to bridge at %s", url)
        while True:
            try:
                async with websockets.connect(url, ping_interval=30) as ws:
                    logger.info("[meshcore] bridge connected: %s", url)
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                            if msg.get("type") == "node_update":
                                entity = normalize_mesh_node(msg["data"])
                                if entity:
                                    await publish_entity(entity)
                        except Exception as exc:
                            logger.debug("[meshcore] parse error: %s", exc)
            except Exception as exc:
                logger.error("[meshcore] bridge error (%s): %s — retry in %ds", url, exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)
