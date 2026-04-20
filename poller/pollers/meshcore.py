"""
MeshCore poller — subscribes to the MeshCore bridge WebSocket and
normalises node updates into the canonical Entity model.
"""

import asyncio
import json
import logging

import websockets

from bus import publish_entity
from config import settings
from normalizers.mesh_node import normalize_mesh_node
from .base import BasePoller

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10


class MeshCorePoller(BasePoller):
    name = "meshcore"
    interval = 10

    async def poll(self):
        pass  # streaming — overrides run()

    async def run(self):
        if not settings.meshcore_bridge_host:
            logger.warning("[meshcore] MESHCORE_BRIDGE_HOST not set — poller inactive")
            return

        url = f"ws://{settings.meshcore_bridge_host}:{settings.meshcore_bridge_port}"
        logger.info("[meshcore] connecting to bridge at %s", url)

        while True:
            try:
                async with websockets.connect(url, ping_interval=30) as ws:
                    logger.info("[meshcore] bridge connected")
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
                logger.error("[meshcore] bridge error: %s — retry in %ds", exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)
