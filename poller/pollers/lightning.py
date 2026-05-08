"""
Lightning strike poller — subscribes to the Blitzortung real-time WebSocket
and publishes strikes as a rolling feed for the frontend map layer.

Blitzortung is a worldwide crowdsourced lightning detection network.
Data is freely available without an API key.

Protocol:
    Connect to any Blitzortung WebSocket server (ws1..ws8) over WSS (443)
  Send subscription JSON with the bounding box of interest
  Receive JSON messages: {"time": <nanoseconds>, "lat": <deg>, "lon": <deg>}

Strikes are accumulated in a 5-second window and published as
feed:lightning:strikes so the backend can relay them to the frontend
without writing individual rows to the database.
"""

import asyncio
import json
import logging
import random
import time
from datetime import datetime, timezone

from bus import set_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_WS_SERVERS = [
    # Use standard TLS WebSocket endpoint (443). The legacy 800x ports are
    # frequently closed/filtered in container and cloud environments.
    f"wss://{host}.blitzortung.org/"
    for host in ("ws1", "ws2", "ws7", "ws8")
]
_FLUSH_INTERVAL  = 5      # seconds between feed publishes
_MAX_BUFFER      = 500    # max strikes held in the rolling buffer
_RECONNECT_DELAY = 5      # seconds before first retry
_MAX_RECONNECT   = 120    # seconds maximum retry backoff
_BBOX_PAD        = 5.0    # degrees padding around configured bbox


class LightningPoller(BasePoller):
    name     = "lightning"
    interval = 60   # unused — streaming override below

    async def poll(self):
        pass  # overridden by run()

    async def run(self):
        logger.info("[lightning] Blitzortung poller starting")
        delay = _RECONNECT_DELAY
        while True:
            try:
                await self._connect_and_stream()
                delay = _RECONNECT_DELAY
            except Exception as exc:
                logger.warning("[lightning] connection error: %s — retry in %ds", exc, delay)
                await self._heartbeat("error", str(exc)[:200])
            await asyncio.sleep(delay)
            delay = min(delay * 2, _MAX_RECONNECT)

    async def _connect_and_stream(self):
        import websockets

        server = random.choice(_WS_SERVERS)
        sub = json.dumps({
            "west":  settings.bbox_min_lon - _BBOX_PAD,
            "east":  settings.bbox_max_lon + _BBOX_PAD,
            "south": settings.bbox_min_lat - _BBOX_PAD,
            "north": settings.bbox_max_lat + _BBOX_PAD,
        })

        logger.info("[lightning] connecting to %s", server)
        async with websockets.connect(
            server, ping_interval=30, ping_timeout=15, open_timeout=15
        ) as ws:
            await ws.send(sub)
            logger.info("[lightning] subscribed to Blitzortung feed")
            await self._heartbeat("ok")

            buffer: list[dict] = []
            last_flush = time.monotonic()

            async for raw in ws:
                try:
                    data = json.loads(raw)
                    strikes = self._parse_message(data)
                    buffer.extend(strikes)
                    # Cap buffer to avoid unbounded growth during connection pauses
                    if len(buffer) > _MAX_BUFFER:
                        buffer = buffer[-_MAX_BUFFER:]
                except Exception as exc:
                    logger.debug("[lightning] parse error: %s", exc)
                    continue

                now = time.monotonic()
                if now - last_flush >= _FLUSH_INTERVAL and buffer:
                    await set_feed("lightning:strikes", buffer[-_MAX_BUFFER:])
                    buffer = []
                    last_flush = now
                    await self._heartbeat("ok")

    def _parse_message(self, data: dict) -> list[dict]:
        # API returns either a single strike dict or {"strikes": [...]}
        raw_strikes = data.get("strikes", [data] if "lat" in data or "lon" in data else [])
        result: list[dict] = []

        for s in raw_strikes:
            lat_raw = s.get("lat")
            lon_raw = s.get("lon")
            if lat_raw is None or lon_raw is None:
                continue

            # Some protocol versions scale lat/lon by 1000 (integer degrees × 1000)
            lat = float(lat_raw)
            lon = float(lon_raw)
            if abs(lat) > 90:
                lat /= 1000.0
                lon /= 1000.0

            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                continue

            ns_time = s.get("time")
            if ns_time:
                if not isinstance(ns_time, (int, float)) or not (0 < ns_time < 2e18):
                    logger.debug("[lightning] invalid timestamp %r, skipping strike", ns_time)
                    continue
                ts_ms = int(ns_time) // 1_000_000
            else:
                ts_ms = int(time.time() * 1000)

            result.append({"lat": lat, "lon": lon, "ts": ts_ms})

        return result
