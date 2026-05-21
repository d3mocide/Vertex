"""
MQTT subscriber poller — subscribes to the local Mosquitto broker and
dispatches incoming messages to per-normalizer handlers.

Sources are loaded from the mqtt_sources DB table (seeded from sources.yml).
Multiple sources on the same (broker, port) share a single connection.
Each broker connection runs as an independent async task and reconnects
automatically on failure.

Authentication: when auth_enabled=True for a source, credentials are loaded
from environment variables keyed by the sanitized source name:
  MQTT_{UPPER_SNAKE_NAME}_USERNAME
  MQTT_{UPPER_SNAKE_NAME}_PASSWORD

Supported normalizers: rtl_433, meshtastic, ais
"""

import asyncio
import logging
import os
import re

import aiomqtt

from .base import BasePoller
import normalizers.rtl_433        as _rtl_433
import normalizers.meshtastic_mqtt as _meshtastic
import normalizers.ais_mqtt        as _ais

logger = logging.getLogger(__name__)

_RETRY_DELAY     = 10    # seconds between reconnect attempts
_KEEPALIVE       = 60    # MQTT keepalive interval

_NORMALIZERS: dict = {
    "rtl_433":    _rtl_433.handle,
    "meshtastic": _meshtastic.handle,
    "ais":        _ais.handle,
}


class MqttSubscriberPoller(BasePoller):
    name     = "mqtt"
    interval = 60   # heartbeat only; actual work is event-driven

    def __init__(self):
        self._sources: list[dict] = []

    async def poll(self):
        pass  # streaming poller — overrides run()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT name, normalizer, broker, port, topic, qos, auth_enabled "
            "FROM mqtt_sources WHERE enabled = TRUE"
        )
        self._sources = [dict(row) for row in rows]
        if self._sources:
            logger.info("[mqtt] %d source(s): %s", len(self._sources),
                        [s["name"] for s in self._sources])
        else:
            logger.info("[mqtt] no enabled MQTT sources — subscriber inactive")

    async def run(self):
        await self.setup()
        if not self._sources:
            return

        # Group sources by (broker, port) — one connection per broker
        groups: dict[tuple, list[dict]] = {}
        for src in self._sources:
            key = (src["broker"], src["port"])
            groups.setdefault(key, []).append(src)

        tasks = [
            asyncio.create_task(
                self._run_broker(broker, port, sources),
                name=f"mqtt:{broker}:{port}",
            )
            for (broker, port), sources in groups.items()
        ]
        await asyncio.gather(*tasks)

    async def _run_broker(
        self, broker: str, port: int, sources: list[dict]
    ) -> None:
        username, password = _broker_auth(sources)
        topic_map = {src["topic"]: src for src in sources}

        logger.info("[mqtt] connecting to %s:%s (%d topic(s))", broker, port, len(sources))

        while True:
            try:
                async with aiomqtt.Client(
                    hostname=broker,
                    port=port,
                    username=username,
                    password=password,
                    keepalive=_KEEPALIVE,
                ) as client:
                    for src in sources:
                        await client.subscribe(src["topic"], qos=src["qos"])
                        logger.debug("[mqtt] subscribed: %s → %s", src["name"], src["topic"])

                    async for message in client.messages:
                        topic_str = str(message.topic)
                        payload   = _decode_payload(message.payload)
                        src = _match_source(topic_str, topic_map)
                        if src is None:
                            continue
                        normalizer_name = src["normalizer"]
                        handler = _NORMALIZERS.get(normalizer_name)
                        if handler is None:
                            logger.warning("[mqtt] unknown normalizer %r for topic %s",
                                           normalizer_name, topic_str)
                            continue
                        try:
                            await handler(topic_str, payload)
                        except Exception as exc:
                            logger.warning("[mqtt] handler error (%s / %s): %s",
                                           normalizer_name, topic_str, exc)

            except aiomqtt.MqttError as exc:
                logger.warning("[mqtt] broker %s:%s error: %s — retry in %ds",
                               broker, port, exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)
            except Exception as exc:
                logger.error("[mqtt] unexpected error on %s:%s: %s — retry in %ds",
                             broker, port, exc, _RETRY_DELAY)
                await asyncio.sleep(_RETRY_DELAY)


def _broker_auth(sources: list[dict]) -> tuple[str | None, str | None]:
    """Return (username, password) for the first auth-enabled source in the group."""
    for src in sources:
        if src.get("auth_enabled"):
            key = re.sub(r"[^A-Z0-9]+", "_", src["name"].upper()).strip("_")
            username = os.environ.get(f"MQTT_{key}_USERNAME")
            password = os.environ.get(f"MQTT_{key}_PASSWORD")
            if username:
                return username, password
    return None, None


def _decode_payload(payload) -> str:
    if isinstance(payload, (bytes, bytearray)):
        return payload.decode("utf-8", errors="replace")
    return str(payload)


def _match_source(topic: str, topic_map: dict[str, dict]) -> dict | None:
    """Match an incoming topic against registered subscription patterns."""
    for pattern, src in topic_map.items():
        if _topic_matches(pattern, topic):
            return src
    return None


def _topic_matches(pattern: str, topic: str) -> bool:
    """MQTT wildcard matching: + matches one level, # matches remaining levels."""
    p_parts = pattern.split("/")
    t_parts = topic.split("/")

    for i, p in enumerate(p_parts):
        if p == "#":
            return True
        if i >= len(t_parts):
            return False
        if p != "+" and p != t_parts[i]:
            return False

    return len(p_parts) == len(t_parts)
