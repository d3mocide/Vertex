"""
ACARS poller — connects to ACARSHub via its Socket.IO API (Engine.IO v4).

ACARSHub does NOT expose a REST API.  All data is streamed over a Socket.IO
WebSocket on the /main namespace.  On connection the server immediately pushes
batches of recent messages via the `acars_msg_batch` event, and pushes live
messages as `new_message` events.  A `query_search` emit fetches the full DB.

Configure by adding an entry to sources.yml under poller_sources:

    poller_sources:
      - type: acars
        name: ACARSHub
        url: http://192.168.1.100:8080
        enabled: true

The poller:
 1. Connects to <url>/socket.io/ via WebSocket (Engine.IO v4 + Socket.IO v5).
 2. Joins the /main namespace.
 3. Emits `query_search` to pull historical messages from the DB.
 4. Listens for `acars_msg_batch` and `new_message` events indefinitely.
 5. Persists new frames to acars_messages and publishes live ones to Redis.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import websockets
from websockets.exceptions import WebSocketException

from bus import get_bus
from db import write_acars_message, get_pool
from sanitize import sanitize_payload, sanitize_text
from .base import BasePoller

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT   = 10
_MAX_BATCH         = 500      # max messages processed per batch event
_RECONNECT_DELAY   = 15       # seconds before reconnecting on error
_SEARCH_PAGE_SIZE  = 100      # messages to request per query_search page
_WS_PING_INTERVAL  = 15       # websocket keepalive for idle proxies / upstreams
_WS_PING_TIMEOUT   = 15



class AcarsPoller(BasePoller):
    """Long-running Socket.IO listener for ACARSHub.

    This poller overrides the BasePoller loop: instead of a recurring `poll()`
    tick, it maintains a persistent WebSocket connection per source and relies
    on server-pushed events.  The `poll()` method is a no-op; `run()` launches
    a dedicated asyncio task per source URL.
    """
    name     = "acars"
    interval = 60  # not used — kept for BasePoller compatibility

    def __init__(self):
        self._urls: list[str]        = []
        self._startup_ts: float      = 0.0
        self._listener_tasks: list   = []

    # ── BasePoller hooks ──────────────────────────────────────────────────────

    async def setup(self):
        self._startup_ts = time.time()
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'acars' AND enabled = TRUE"
        )
        self._urls = [r["url"].rstrip("/") for r in rows]
        if self._urls:
            logger.info("[acars] %d ACARSHub source(s): %s", len(self._urls), self._urls)
        else:
            logger.warning("[acars] no ACARS source configured — poller inactive")

    async def poll(self):
        """Ensure listener tasks are running (re-launch if crashed)."""
        if not self._urls:
            return
        # Start any missing tasks
        alive = {t.get_name() for t in self._listener_tasks if not t.done()}
        for base_url in self._urls:
            task_name = f"acars-listener:{base_url}"
            if task_name not in alive:
                t = asyncio.create_task(
                    self._listen_forever(base_url),
                    name=task_name,
                )
                self._listener_tasks.append(t)
                logger.info("[acars] started listener task for %s", base_url)

    # ── Per-source WebSocket listener ─────────────────────────────────────────

    async def _listen_forever(self, base_url: str):
        """Reconnecting loop for a single ACARSHub source."""
        while True:
            try:
                await self._run_session(base_url)
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning(
                    "[acars] %s session error: %s — reconnecting in %ds",
                    base_url, exc, _RECONNECT_DELAY,
                )
            await asyncio.sleep(_RECONNECT_DELAY)

    async def _run_session(self, base_url: str):
        """Single WebSocket session.  Raises on error (caller reconnects)."""
        ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
        uri    = f"{ws_url}/socket.io/?EIO=4&transport=websocket"

        logger.debug("[acars] connecting to %s", uri)
        async with websockets.connect(
            uri,
            open_timeout=_CONNECT_TIMEOUT,
            ping_interval=_WS_PING_INTERVAL,
            ping_timeout=_WS_PING_TIMEOUT,
            max_size=10 * 1024 * 1024,
        ) as ws:
            # ── Engine.IO handshake ───────────────────────────────────────────
            hs_raw = await asyncio.wait_for(ws.recv(), timeout=_CONNECT_TIMEOUT)
            if not hs_raw.startswith("0"):
                raise ValueError(f"Unexpected EIO handshake: {hs_raw[:80]}")
            hs = json.loads(hs_raw[1:])
            ping_interval = hs.get("pingInterval", 25000) / 1000
            ping_timeout = hs.get("pingTimeout", 20000) / 1000

            # ── Socket.IO connect to default namespace ────────────────────────
            await ws.send("40")
            await asyncio.wait_for(ws.recv(), timeout=_CONNECT_TIMEOUT)

            # ── Socket.IO connect to /main namespace ──────────────────────────
            await ws.send("40/main,{}")
            conn_ack = await asyncio.wait_for(ws.recv(), timeout=_CONNECT_TIMEOUT)
            if "/main" not in conn_ack:
                raise ValueError(f"Did not receive /main namespace ack: {conn_ack[:80]}")
            logger.info("[acars] connected to %s /main", base_url)

            # ── Request message history (first page) ─────────────────────────
            # Subsequent pages are requested after database_search_results
            # reports that more messages exist.
            await self._request_search_page(ws, 0)

            # ── Main receive loop ─────────────────────────────────────────────
            last_server_ping = time.monotonic()
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    if (time.monotonic() - last_server_ping) > (ping_interval + ping_timeout + 1):
                        raise TimeoutError(
                            f"Engine.IO heartbeat timeout after {ping_interval + ping_timeout:.0f}s"
                        )
                    continue

                # Engine.IO v4 heartbeat is server-driven: server sends ping (2),
                # client must answer with pong (3). Sending unsolicited client pings
                # can cause periodic disconnects on strict Socket.IO servers.
                if raw == "2":
                    await ws.send("3")
                    last_server_ping = time.monotonic()
                    continue

                await self._handle_frame(ws, base_url, raw)


    async def _request_search_page(self, ws, results_after: int):
        """Emit a query_search to the /main namespace requesting a page of messages."""
        query = json.dumps([
            "query_search",
            {"search_term": "", "results_after": results_after, "num_results": _SEARCH_PAGE_SIZE},
        ])
        await ws.send(f"42/main,{query}")
        logger.debug("[acars] query_search page results_after=%d", results_after)

    # ── Frame / event dispatch ─────────────────────────────────────────────────

    async def _handle_frame(self, ws, base_url: str, raw: str):
        """Decode an EIO/SIO frame and dispatch to the appropriate handler."""
        if not raw:
            return
        eio_type = raw[0]

        if eio_type in ("2", "3"):  # ping/pong handled in the recv loop
            return
        if eio_type != "4":         # not a message packet
            return

        # Socket.IO message (EIO type 4)
        sio_payload = raw[1:]
        if not sio_payload:
            return

        sio_type = sio_payload[0]
        if sio_type not in ("2", "3"):  # only EVENT (2) and ACK (3)
            return

        # Strip namespace prefix   e.g. "/main,["event",...]"
        body = sio_payload[1:]
        if body.startswith("/main,"):
            body = body[len("/main,"):]

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            return

        if not isinstance(parsed, list) or not parsed:
            return

        event_name = parsed[0]
        event_data = parsed[1] if len(parsed) > 1 else {}

        if event_name in ("acars_msg_batch", "new_message"):
            await self._handle_batch(base_url, event_name, event_data)
        elif event_name == "database_search_results":
            await self._handle_search_results(ws, base_url, event_data)


    async def _handle_batch(self, base_url: str, event_name: str, data: dict):
        """Handle acars_msg_batch or new_message events."""
        if isinstance(data, list):
            # new_message sometimes arrives as bare list
            messages = data
        else:
            messages = data.get("messages") or []
            if not isinstance(messages, list):
                messages = [data]

        new_count = 0
        for raw in messages[:_MAX_BATCH]:
            if not isinstance(raw, dict):
                continue
            msg_ts    = float(raw.get("timestamp") or 0)
            is_new    = await write_acars_message(self._normalise(raw))
            is_live   = msg_ts >= self._startup_ts
            if is_new and is_live:
                await self._publish(raw)
                new_count += 1

        if new_count:
            logger.debug("[acars] %s [%s] → %d new live message(s)", base_url, event_name, new_count)

    async def _handle_search_results(self, ws, base_url: str, data: dict):
        """Handle database_search_results (historical batch), auto-paginating."""
        messages = data.get("msghtml") or []
        if not isinstance(messages, list):
            return
        new_count = 0
        max_id = 0
        for raw in messages[:_MAX_BATCH]:
            if not isinstance(raw, dict):
                continue
            is_new = await write_acars_message(self._normalise(raw))
            if is_new:
                new_count += 1
            # track the highest ID seen to know our pagination position
            msg_id = int(raw.get("id") or 0)
            if msg_id > max_id:
                max_id = msg_id
        if new_count:
            logger.info("[acars] %s synced %d historical message(s)", base_url, new_count)
        # If we got a full page, there may be more — request next page
        if len(messages) >= _SEARCH_PAGE_SIZE and max_id > 0:
            await self._request_search_page(ws, max_id)


    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _normalise(raw: dict) -> dict:
        """Normalise ACARSHub field names to our DB schema.

        ACARSHub uses `text` for message body and `msgno` for message number;
        our schema uses `msg_text` / `msg_num`.  Timestamps are always
        unix floats under the `timestamp` key.

        ACARSHub also sends `freq` as a float (e.g., 131.55) and `error` as
        an int; sanitize_text() expects strings so we coerce them here.
        """
        out = dict(raw)
        # Field name aliases
        if "text" in raw and "msg_text" not in raw:
            out["msg_text"] = raw["text"]
        if "msgno" in raw and "msg_num" not in raw:
            out["msg_num"] = raw["msgno"]
        # Type coercions — sanitize_text() calls str.replace(); floats/ints break it
        if "freq" in out:
            out["freq"] = str(out["freq"])
        if "error" in out:
            out["error"] = int(out["error"]) if out["error"] is not None else 0
        return out


    async def _publish(self, raw: dict):
        """Publish a live ACARS message to the Redis civic:updates channel."""
        msg_ts = float(raw.get("timestamp") or 0)
        ts_iso = (
            datetime.fromtimestamp(msg_ts, tz=timezone.utc).isoformat()
            if msg_ts > 0
            else datetime.now(timezone.utc).isoformat()
        )
        payload = sanitize_payload({
            "type": "acars_message",
            "data": {
                "tail":       sanitize_text(raw.get("tail") or ""),
                "flight":     sanitize_text(raw.get("flight") or ""),
                "freq":       sanitize_text(str(raw.get("freq") or "")),
                "label":      sanitize_text(raw.get("label") or ""),
                "msg_num":    sanitize_text(raw.get("msgno") or raw.get("msg_num") or ""),
                "msg_text":   sanitize_text(raw.get("text") or raw.get("msg_text") or ""),
                "station_id": sanitize_text(raw.get("station_id") or ""),
                "error":      int(raw.get("error") or 0),
                "mode":       sanitize_text(raw.get("mode") or ""),
                "ts":         ts_iso,
            },
        })
        r = await get_bus()
        await r.publish("civic:updates", json.dumps(payload))
