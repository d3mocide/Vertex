"""
P25 poller — polls the OP25 HTTP terminal for active talkgroup metadata.

OP25's multi_rx.py serves a web terminal on port 8080. This poller hits
the state endpoint, writes the active talkgroup to Redis, and persists
call-start/call-end events to Postgres via the event stream.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx

from bus import set_feed, get_bus
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_OP25_BASE = f"http://{settings.op25_host}:{settings.op25_port}"

# OP25 state field values
_STATE_CALL = 1
_STATE_IDLE = 0


class P25Poller(BasePoller):
    name = "p25"
    interval = 2  # 2-second poll for near-real-time metadata display

    def __init__(self):
        self._last_tgid: int | None = None
        self._call_start: str | None = None

    async def poll(self):
        try:
            # OP25 terminal state endpoint — POST with empty body returns JSON state
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.post(_OP25_BASE, data={})
            data = resp.json()
        except Exception as exc:
            logger.debug("[p25] terminal unreachable: %s", exc)
            return

        state    = _normalize_state(data)
        tgid     = state.get("tgid")
        tag      = state.get("tag", "")
        is_call  = state.get("state") == "call"

        await set_feed("radio:active", state)

        # Detect call-start / call-end transitions and write Event records
        if tgid != self._last_tgid:
            if self._last_tgid is not None and self._call_start:
                await _write_event("p25_call_end", {
                    "tgid":       self._last_tgid,
                    "tag":        tag,
                    "started_at": self._call_start,
                    "ended_at":   _now(),
                })
            if tgid and is_call:
                self._call_start = _now()
                await _write_event("p25_call_start", {
                    "tgid":       tgid,
                    "tag":        tag,
                    "freq_hz":    state.get("freq_hz"),
                    "started_at": self._call_start,
                })
            self._last_tgid = tgid


def _normalize_state(data: dict) -> dict:
    """Normalise OP25 terminal JSON to a stable schema."""
    # OP25 may return slightly different keys across versions
    tgid = data.get("curr_tgid") or data.get("tgid") or data.get("holdtgid")
    tag  = data.get("curr_tag")  or data.get("tag", "")
    freq = data.get("curr_freq") or data.get("freq")
    raw_state = data.get("state", 0)

    return {
        "tgid":    int(tgid) if tgid else None,
        "tag":     str(tag).strip(),
        "freq_hz": int(freq) if freq else None,
        "state":   "call" if raw_state == _STATE_CALL else "idle",
        "updated": _now(),
    }


async def _write_event(event_type: str, details: dict):
    r = await get_bus()
    event = {
        "event_id":   str(uuid.uuid4()),
        "event_type": event_type,
        "entity_id":  None,
        "ts":         _now(),
        "severity":   "info",
        "summary":    f"TGID {details.get('tgid')} — {details.get('tag', '')}",
        "details":    details,
    }
    await r.publish("civic:updates", json.dumps({"type": "event", "data": event}))
    logger.info("[p25] %s tgid=%s tag=%s", event_type, details.get("tgid"), details.get("tag"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
