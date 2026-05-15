"""
ACARS poller — fetches decoded ACARS messages from a locally running ACARSHub
instance (https://github.com/sdr-enthusiasts/docker-acarshub).

Configure by adding an entry to sources.yml under poller_sources:

    poller_sources:
      - type: acars
        name: ACARSHub
        url: http://192.168.1.100:8080
        enabled: true

The poller hits ACARSHub's REST API at <url>/api/ every 5 seconds, persists
new messages to the acars_messages table, and publishes each new message to
Redis so the frontend receives it in real time via WebSocket.
"""

import json
import logging
from datetime import datetime, timezone

import httpx

from bus import get_bus
from db import write_acars_message, get_pool
from sanitize import sanitize_payload, sanitize_text
from .base import BasePoller

logger = logging.getLogger(__name__)

_API_PATHS = ["/api/", "/api"]
_FETCH_TIMEOUT = 8
_MAX_MESSAGES_PER_POLL = 200


class AcarsPoller(BasePoller):
    name = "acars"
    interval = 5

    def __init__(self):
        self._urls: list[str] = []
        self._last_ts: dict[str, float] = {}  # base_url → max unix timestamp seen

    async def setup(self):
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'acars' AND enabled = TRUE"
        )
        self._urls = [r["url"].rstrip("/") for r in rows]
        if self._urls:
            logger.info("[acars] %d ACARSHub source(s): %s", len(self._urls), self._urls)
        else:
            logger.warning("[acars] no ACARS source configured — poller inactive")

    async def poll(self):
        if not self._urls:
            return
        for base_url in self._urls:
            await self._poll_one(base_url)

    async def _poll_one(self, base_url: str):
        raw_messages = await self._fetch_messages(base_url)
        if raw_messages is None:
            return

        last_ts = self._last_ts.get(base_url, 0.0)
        new_max_ts = last_ts
        new_count = 0

        for raw in raw_messages[:_MAX_MESSAGES_PER_POLL]:
            if not isinstance(raw, dict):
                continue
            msg_ts = float(raw.get("timestamp") or 0)
            if msg_ts <= last_ts:
                continue

            # Persist and publish
            is_new = await write_acars_message(raw)
            if is_new:
                await self._publish(raw)
                new_count += 1

            if msg_ts > new_max_ts:
                new_max_ts = msg_ts

        if new_max_ts > last_ts:
            self._last_ts[base_url] = new_max_ts

        if new_count:
            logger.debug("[acars] %s → %d new message(s)", base_url, new_count)

    async def _fetch_messages(self, base_url: str) -> list | None:
        last_ts = self._last_ts.get(base_url, 0.0)
        params: dict = {}
        if last_ts == 0.0:
            # First poll — seed with the last hour to avoid flooding Redis on startup
            params["lookback_hours"] = 1

        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT) as client:
            for path in _API_PATHS:
                try:
                    resp = await client.get(f"{base_url}{path}", params=params)
                    if resp.status_code == 404:
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    # ACARSHub returns {"messages": [...], "num_results": N}
                    # or may return a bare list in some versions
                    if isinstance(data, dict):
                        return data.get("messages") or []
                    if isinstance(data, list):
                        return data
                    return []
                except httpx.HTTPStatusError:
                    continue
                except Exception as exc:
                    logger.debug("[acars] %s%s unreachable: %s", base_url, path, exc)
                    return None
        return None

    async def _publish(self, raw: dict):
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
                "freq":       sanitize_text(raw.get("freq") or ""),
                "label":      sanitize_text(raw.get("label") or ""),
                "msg_num":    sanitize_text(raw.get("msg_num") or ""),
                "msg_text":   sanitize_text(raw.get("msg_text") or ""),
                "station_id": sanitize_text(raw.get("station_id") or ""),
                "error":      int(raw.get("error") or 0),
                "mode":       sanitize_text(raw.get("mode") or ""),
                "ts":         ts_iso,
            },
        })
        r = await get_bus()
        await r.publish("civic:updates", json.dumps(payload))
