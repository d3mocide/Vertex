"""Tocsin: NOAA Weather Radio alerts, RF health and the latest NWR transcript.

Tocsin (a separate project, run next to the SDRs) decodes SAME headers off the weather-radio broadcast and fuses
them with the NWS CAP feed. This poller keeps three Redis feeds fresh for the Environment page:

* weather:alerts   the CAP alert list with Tocsin's RF-heard alerts merged in (poller/nwr_alerts.py)
* nwr:alerts       Tocsin's own alerts for the operator's zones, as mapped
* nwr:status       stream / dongle health and the latest spoken broadcast

It follows Tocsin's /events SSE stream so an alert shows up as soon as it is decoded, and re-reads the REST
endpoints every REFRESH_S as well so expiry and a dropped stream cannot leave a stale alert on screen.
Runs in the radio service (poller/radio_main.py).
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx

from bus import get_bus, set_feed
from config import settings
from db import get_pool
from nwr_alerts import is_relevant, merge, normalize, zone_set
from redaction import redact_text, redact_url
from security import validate_safe_url
from .base import BasePoller

logger = logging.getLogger(__name__)

REFRESH_S = 30
_SSE_RETRY_S = 10
_TRANSCRIPT_KEEP = 20


async def _sse_events(lines):
    """Yield (event, data) from an async iterator of SSE lines."""
    event, data = "message", []
    async for line in lines:
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())


class TocsinPoller(BasePoller):
    name = "tocsin"
    interval = 0  # event-driven

    def __init__(self):
        self._dirty = asyncio.Event()
        self._base = ""
        self._headers: dict[str, str] = {}

    async def run(self) -> None:
        base = (settings.tocsin_url or "").strip().rstrip("/")
        if not base:
            logger.info("[tocsin] TOCSIN_URL not set — NOAA Weather Radio integration off")
            return
        try:
            await validate_safe_url(base, allowed_schemes={"http", "https"})
        except ValueError as exc:
            logger.warning("[tocsin] blocked %s: %s (private hosts need PRIVATE_HOST_ALLOWLIST)", redact_url(base), exc)
            return
        self._base = base
        if settings.tocsin_api_key:
            self._headers = {"X-API-Key": settings.tocsin_api_key}
        logger.info("[tocsin] following %s", redact_url(base))
        sse = asyncio.create_task(self._sse_loop())
        try:
            async with self.streaming():
                while True:
                    try:
                        await self._refresh()
                    except Exception as exc:
                        logger.warning("[tocsin] refresh failed: %s", redact_text(exc))
                        await self._heartbeat("error", str(exc)[:256])
                        await set_feed("nwr:status", {"reachable": False, "updated": datetime.now(timezone.utc).isoformat()},
                                       broadcast=False)
                    try:
                        await asyncio.wait_for(self._dirty.wait(), REFRESH_S)
                    except asyncio.TimeoutError:
                        pass
                    self._dirty.clear()
        finally:
            sse.cancel()

    async def poll(self) -> None:
        pass

    # ── live stream ───────────────────────────────────────────────────────

    async def _sse_loop(self) -> None:
        while True:
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=None), headers=self._headers) as client:
                    async with client.stream("GET", f"{self._base}/events", headers={"Accept": "text/event-stream"}) as resp:
                        resp.raise_for_status()
                        async for event, _data in _sse_events(resp.aiter_lines()):
                            # Health samples arrive many times a second; only alerts and speech change what we show.
                            if event in ("alert", "transcript", "dispatch"):
                                self._dirty.set()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.debug("[tocsin] event stream dropped: %s", redact_text(exc))
            await asyncio.sleep(_SSE_RETRY_S)

    # ── refresh ───────────────────────────────────────────────────────────

    async def _zones(self) -> set[str]:
        if "nws_alert_zones" in getattr(settings, "model_fields_set", set()):
            return zone_set(settings.nws_alert_zones)
        try:
            rows = await get_pool().fetch("SELECT zone_code FROM alert_zone_configs WHERE enabled = TRUE")
        except Exception:
            rows = []
        return zone_set(",".join(r["zone_code"] for r in rows)) if rows else zone_set(settings.nws_alert_zones)

    async def _get(self, client: httpx.AsyncClient, path: str, **params):
        resp = await client.get(f"{self._base}{path}", params=params or None)
        resp.raise_for_status()
        return resp.json()

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=10, headers=self._headers) as client:
            alerts = await self._get(client, "/alerts", limit=50)
            transcripts = await self._get(client, "/transcripts", limit=_TRANSCRIPT_KEEP)
            streams = await self._get(client, "/streams")
            health = await self._get(client, "/health")

        spoken = {t.get("raw_header"): t.get("text", "") for t in transcripts if t.get("raw_header")}
        zones = await self._zones()
        now = datetime.now(timezone.utc)
        mapped = []
        for alert in alerts:
            if not is_relevant(alert, zones):
                continue
            rf = next((s.get("event") for s in alert.get("sources", []) if s.get("kind") == "RF"), None) or {}
            item = normalize(alert, now, spoken.get(rf.get("raw_header"), ""))
            if item:
                mapped.append(item)
        await set_feed("nwr:alerts", mapped, broadcast=False)

        r = await get_bus()
        raw = await r.get("feed:weather:alerts")
        try:
            current = json.loads(raw) if raw else []
        except (json.JSONDecodeError, TypeError):
            current = []
        cap = [a for a in current if isinstance(a, dict)] if isinstance(current, list) else []
        merged = merge(cap, mapped)
        if merged != cap:
            await set_feed("weather:alerts", merged)

        live = next((t for t in transcripts if str(t.get("event_code")) == "LIVE"), None)
        mounts = [s for s in streams.get("streams", []) if s.get("on_air") is not None]
        await set_feed("nwr:status", {
            "reachable": True,
            "icecast": bool(streams.get("icecast_reachable")),
            "streams": [{"mount": s.get("mount"), "site": s.get("site"), "channel": s.get("channel"),
                         "on_air": bool(s.get("on_air")), "listeners": s.get("listeners", 0)} for s in mounts],
            "channels_dead": sorted({f'{h.get("site")}/{h.get("channel")}' for h in health if h.get("dead")}),
            "last_spoken": ({"text": live.get("text", ""), "channel": live.get("channel"),
                             "at": datetime.fromtimestamp(live["timestamp_ns"] / 1e9, timezone.utc).isoformat()}
                            if live and live.get("timestamp_ns") else None),
            "updated": now.isoformat(),
        }, broadcast=False)
        await self._alive()
