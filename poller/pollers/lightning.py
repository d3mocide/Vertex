"""
Lightning strike poller — subscribes to the Blitzortung real-time WebSocket
and publishes strikes as a rolling feed for the frontend map layer.

Blitzortung is a worldwide crowdsourced lightning detection network.
Data is freely available without an API key.

Protocol (unofficial, as used by blitzortung.org's own map):
  Connect to a Blitzortung WebSocket server (ws1, ws2, ws7, ws8) over WSS (443)
  Send {"a": 111} — the server then streams *every* strike worldwide (~5-10/s)
  Each frame is a JSON strike {"time": <ns>, "lat": <deg>, "lon": <deg>, ...}
  compressed with a small LZW-style scheme (see _decode). Bounding-box
  subscriptions are ignored by the server, so strikes are filtered here.

The earlier bounding-box subscription never received a single frame.

Strikes are accumulated in a 5-second window and published as
feed:lightning:strikes so the backend can relay them to the frontend
without writing individual rows to the database.
"""

import asyncio
import json
import logging
import random
import time

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


def _decode(frame: str) -> str:
    """Undo Blitzortung's LZW-style frame compression."""
    if not frame:
        return frame
    table: dict[int, str] = {}
    chars = list(frame)
    cur = chars[0]
    prev = cur
    out = [cur]
    next_code = 256
    for ch in chars[1:]:
        code = ord(ch)
        entry = ch if code < 256 else table.get(code, prev + cur)
        out.append(entry)
        cur = entry[0]
        table[next_code] = prev + cur
        next_code += 1
        prev = entry
    return "".join(out)


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
        sub = json.dumps({"a": 111})

        logger.info("[lightning] connecting to %s", server)
        async with websockets.connect(
            server, ping_interval=30, ping_timeout=15, open_timeout=15
        ) as ws, self.streaming():
            await ws.send(sub)
            logger.info("[lightning] subscribed to Blitzortung feed")

            buffer: list[dict] = []
            last_flush = time.monotonic()

            async for raw in ws:
                try:
                    data = json.loads(_decode(raw) if isinstance(raw, str) else raw)
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

    @staticmethod
    def _near(lat: float, lon: float) -> bool:
        return (settings.bbox_min_lat - _BBOX_PAD <= lat <= settings.bbox_max_lat + _BBOX_PAD
                and settings.bbox_min_lon - _BBOX_PAD <= lon <= settings.bbox_max_lon + _BBOX_PAD)

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
            # The server sends the whole world; keep what is near us.
            if not self._near(lat, lon):
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
