"""
P25 poller — polls the OP25 HTTP terminal for active talkgroup metadata.

OP25's multi_rx.py serves a web terminal on port 8080. This poller hits
the state endpoint, writes the active talkgroup to Redis, and persists
call-start/call-end events to Postgres via the event stream.

Priority enforcement: talkgroup priorities loaded from DB are used to cap
how long a low-priority channel monopolizes the scanner. When a TGID has
been active beyond its priority-weighted budget, a OP25 skip command is
sent to force the scanner to the next slot.
"""

import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

import httpx

from bus import set_feed, get_bus
from sanitize import sanitize_payload
from .base import BasePoller


logger = logging.getLogger(__name__)

# OP25 state field values
_STATE_CALL = 1
_STATE_IDLE = 0

# Maximum seconds a TGID may hold the scanner per priority level (1=highest).
# Priority 1 (critical ops) is never forcibly skipped.
_MAX_SCAN_SECONDS: dict[int, int] = {
    1: 9999,   # never skip
    2: 120,
    3: 60,
    4: 30,
    5: 15,
}
_PRIORITY_REFRESH_INTERVAL = 60  # re-read talkgroup priorities every 60 polls


class P25Poller(BasePoller):
    name = "p25"
    interval = 2  # 2-second poll for near-real-time metadata display

    def __init__(self):
        self._last_tgid: int | None = None
        self._last_tag: str = ""
        self._call_start: str | None = None
        self._call_start_ts: float = 0.0
        self._op25_url: str | None = None
        self._priorities: dict[int, int] = {}  # {tgid: priority}
        self._priority_poll_counter: int = 0

    async def setup(self):
        from db import get_pool
        row = await get_pool().fetchrow(
            "SELECT url FROM poller_sources WHERE type = 'p25' AND enabled = TRUE LIMIT 1"
        )
        self._op25_url = row["url"] if row else None
        if self._op25_url:
            logger.info("[p25] using OP25 at %s", self._op25_url)
        else:
            logger.warning("[p25] no P25 source configured — poller inactive")
        await self._refresh_priorities()

    async def _refresh_priorities(self):
        try:
            from db import get_pool
            rows = await get_pool().fetch(
                "SELECT tgid, priority FROM talkgroups WHERE scan_enabled = TRUE"
            )
            self._priorities = {int(r["tgid"]): int(r["priority"]) for r in rows}
            logger.debug("[p25] loaded %d talkgroup priorities", len(self._priorities))
        except Exception as exc:
            logger.debug("[p25] priority refresh failed: %s", exc)

    async def poll(self):
        if not self._op25_url:
            return

        self._priority_poll_counter += 1
        if self._priority_poll_counter >= _PRIORITY_REFRESH_INTERVAL:
            self._priority_poll_counter = 0
            await self._refresh_priorities()

        try:
            # OP25 terminal API expects command queue JSON, same as main.js send_process().
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.post(self._op25_url, json=[{
                    "command": "update",
                    "arg1": 0,
                    "arg2": 0,
                }])
            raw = resp.json()
            data = _extract_state_payload(raw)
            if data is None:
                logger.debug("[p25] unsupported payload type: %s", type(raw).__name__)
                return
        except Exception as exc:
            logger.debug("[p25] terminal unreachable: %s", exc)
            return

        state    = _normalize_state(data)
        tgid     = state.get("tgid")
        tag      = state.get("tag", "")
        is_call  = state.get("state") == "call"

        # Annotate state with talkgroup priority for the frontend
        if tgid and tgid in self._priorities:
            state["priority"] = self._priorities[tgid]

        await set_feed("radio:active", state)

        # Detect call-start / call-end transitions and write Event records
        if tgid != self._last_tgid:
            if self._last_tgid is not None and self._call_start:
                await _write_event("p25_call_end", {
                    "tgid":       self._last_tgid,
                    "tag":        self._last_tag,
                    "started_at": self._call_start,
                    "ended_at":   _now(),
                    "priority":   self._priorities.get(self._last_tgid, 3),
                })
            if tgid and is_call:
                self._last_tag = tag
                self._call_start = _now()
                self._call_start_ts = time.monotonic()
                await _write_event("p25_call_start", {
                    "tgid":       tgid,
                    "tag":        tag,
                    "freq_hz":    state.get("freq_hz"),
                    "started_at": self._call_start,
                    "priority":   self._priorities.get(tgid, 3),
                })
            self._last_tgid = tgid

        # Priority-weighted scan enforcement: if the active TGID has exceeded
        # its time budget, send OP25 a skip command to advance the scanner.
        if tgid and is_call and self._call_start_ts > 0:
            priority = self._priorities.get(tgid, 3)
            max_secs = _MAX_SCAN_SECONDS.get(priority, 60)
            elapsed = time.monotonic() - self._call_start_ts
            if elapsed > max_secs:
                await self._send_skip()
                self._call_start_ts = time.monotonic()  # reset timer after skip attempt

    async def _send_skip(self):
        if not self._op25_url:
            return
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                await client.post(self._op25_url, json=[{"command": "skip", "arg1": 0, "arg2": 0}])
            logger.debug("[p25] sent skip command (priority enforcement)")
        except Exception as exc:
            logger.debug("[p25] skip command failed: %s", exc)


def _normalize_state(data: dict) -> dict:
    """Normalise OP25 terminal JSON to a stable schema."""
    # OP25 may return slightly different keys across versions
    tgid = data.get("curr_tgid") or data.get("tgid") or data.get("holdtgid")
    tag  = data.get("curr_tag")  or data.get("tag", "")
    freq = data.get("curr_freq") or data.get("freq")
    raw_state = data.get("state")
    encrypted = data.get("encrypted", 0)

    if raw_state is None:
        if tgid and encrypted == 1:
            state = "encrypted"
        elif tgid:
            state = "call"
        else:
            state = "idle"
    else:
        state = "call" if raw_state == _STATE_CALL else "idle"

    return {
        "tgid":    int(tgid) if tgid else None,
        "tag":     str(tag).strip(),
        "freq_hz": int(freq) if freq else None,
        "state":   state,
        "updated": _now(),
    }


def _extract_state_payload(raw: object) -> dict | None:
    """Handle OP25 variants that return dict or list-wrapped state payloads."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, list):
        trunk_state = _extract_from_trunk_update(raw)
        if trunk_state is not None:
            return trunk_state

        # New OP25 UI returns a list of json_type records; map channel_update
        # into the legacy state shape consumed by _normalize_state.
        channel_update = None
        for item in raw:
            if isinstance(item, dict) and item.get("json_type") == "channel_update":
                channel_update = item
                break

        if isinstance(channel_update, dict):
            channels = channel_update.get("channels") or []
            if channels:
                ch_id = str(channels[0])
                ch = channel_update.get(ch_id)
                if isinstance(ch, dict):
                    return {
                        "curr_tgid": ch.get("tgid"),
                        "curr_tag": ch.get("tag", ""),
                        "curr_freq": ch.get("freq"),
                        "encrypted": ch.get("encrypted", 0),
                    }

        # Fallback for older list payloads where first dict is already state.
        for item in raw:
            if isinstance(item, dict):
                return item
    return None


def _extract_from_trunk_update(raw: list[object]) -> dict | None:
    """Extract active talkgroup info from OP25 trunk_update.frequency_data."""
    trunk_update = None
    for item in raw:
        if isinstance(item, dict) and item.get("json_type") == "trunk_update":
            trunk_update = item
            break

    if not isinstance(trunk_update, dict):
        return None

    system = None
    for value in trunk_update.values():
        if isinstance(value, dict) and "frequency_data" in value:
            system = value
            break

    if not isinstance(system, dict):
        return None

    freq_data = system.get("frequency_data")
    if not isinstance(freq_data, dict):
        return None

    for freq, info in freq_data.items():
        if not isinstance(info, dict):
            continue

        tgids = info.get("tgids") or []
        if not tgids:
            continue

        tgid = next((t for t in tgids if isinstance(t, int) and t > 0), None)
        if not tgid:
            continue

        tags = info.get("tags") or []
        tag = ""
        if isinstance(tags, list):
            for t in tags:
                if isinstance(t, str) and t.strip():
                    tag = t.strip()
                    break

        try:
            freq_hz = int(freq)
        except Exception:
            freq_hz = None

        return {
            "curr_tgid": tgid,
            "curr_tag": tag,
            "curr_freq": freq_hz,
            "state": _STATE_CALL,
        }

    return None


async def _write_event(event_type: str, details: dict):
    r = await get_bus()
    event_id = str(uuid.uuid4())

    # Persist event history so /api/v1/radio/calls can back the talkgroup log UI.
    try:
        from db import write_event
        persisted_id = await write_event(
            event_type=event_type,
            entity_id=None,
            severity="info",
            summary=f"TGID {details.get('tgid')} - {details.get('tag', '')}",
            details=details,
        )
        if persisted_id:
            event_id = persisted_id
    except Exception as exc:
        logger.warning("[p25] event persistence failed: %s", exc)

    event = {
        "event_id":   event_id,
        "event_type": event_type,
        "entity_id":  None,
        "ts":         _now(),
        "severity":   "info",
        "summary":    f"TGID {details.get('tgid')} — {details.get('tag', '')}",
        "details":    details,
    }
    await r.publish("civic:updates", json.dumps(sanitize_payload({"type": "event", "data": event})))
    logger.info("[p25] %s tgid=%s tag=%s", event_type, details.get("tgid"), details.get("tag"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
