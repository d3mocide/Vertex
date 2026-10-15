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
import time
from datetime import datetime, timezone

import httpx

from bus import get_bus, set_feed
from config import settings
from db import get_pool
import nwr_broadcast
from events import emit_event
from nwr_alerts import (LeadTracker, build_areas, event_severity, is_relevant, merge, normalize, outline_ugcs,
                        recent_spoken, round_geometry, zone_set)
from redaction import redact_text, redact_url
from security import validate_request_url, validate_safe_url
from .base import BasePoller

logger = logging.getLogger(__name__)

REFRESH_S = 30
_SSE_RETRY_S = 10
_TRANSCRIPT_KEEP = 120  # about 40 minutes of the broadcast (a ~20 s chunk each): three or four loops of the script
_NWPS_GAUGE_URL = "https://api.water.noaa.gov/nwps/v1/gauges/{lid}"
_GAUGE_REFRESH_S = 600  # official river readings change every 15-60 min
_NOTICE_BOOK_KEY = "nwr:notice_book"
_LEAD_KEY = "nwr:lead_tracker"
_COUNTIES_REFRESH_S = 24 * 3600
_SPOKEN_SHOWN = 8       # about two and a half minutes of the broadcast
_NWS_HEADERS = {"User-Agent": "Vertex/0.1 (vertex; contact@localhost)", "Accept": "application/geo+json"}
_GEOM_RETRY_S = 600   # a county the NWS would not return is retried this often, not on every refresh


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
        self._geom: dict[str, dict | None] = {}          # county outlines never change: fetched once
        self._geom_failed: dict[str, float] = {}
        self._book: nwr_broadcast.NoticeBook | None = None   # what the station has been announcing, across refreshes
        self._official: dict[str, tuple[float, dict | None]] = {}   # NWPS id -> (fetched at, reading)
        self._office: tuple[float, str] = (0.0, "")
        self._seeded = False
        self._counties: dict = {}
        self._counties_at = 0.0
        self._leads: LeadTracker | None = None

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

    async def _load_outlines(self, ugcs: set[str]) -> None:
        """County shapes from the NWS zones API for alerts that need an outline; cached for the process lifetime."""
        missing = [u for u in sorted(ugcs) if u not in self._geom
                   and time.monotonic() - self._geom_failed.get(u, -_GEOM_RETRY_S) >= _GEOM_RETRY_S]
        if not missing:
            return
        async with httpx.AsyncClient(timeout=15, headers=_NWS_HEADERS, event_hooks={"request": [validate_request_url]}) as client:
            for ugc in missing:
                try:
                    resp = await client.get(f"https://api.weather.gov/zones/county/{ugc}")
                    resp.raise_for_status()
                    geometry = (resp.json().get("geometry") or {})
                    if geometry.get("type") in ("Polygon", "MultiPolygon"):
                        self._geom[ugc] = round_geometry(geometry)
                        continue
                except Exception as exc:
                    logger.warning("[tocsin] outline for %s unavailable: %s", ugc, redact_text(exc))
                self._geom_failed[ugc] = time.monotonic()

    async def _office_code(self) -> str:
        """The forecast office whose broadcast this is: the region the operator chose (setup wizard), else the setting."""
        fetched, code = self._office
        if code and time.monotonic() - fetched < 300:
            return code
        code = settings.nws_office
        try:
            from region_sync import _read_stored          # the stored region is the radio service's only link to the wizard
            stored = await _read_stored(get_pool())
            code = ((stored or {}).get("nws") or {}).get("office") or code
        except Exception as exc:
            logger.debug("[tocsin] no stored region: %s", redact_text(exc))
        self._office = (time.monotonic(), code)
        return code

    async def _load_counties(self, client: httpx.AsyncClient) -> None:
        """Tocsin's county names (static reference data), refreshed daily."""
        if self._counties and time.monotonic() - self._counties_at < _COUNTIES_REFRESH_S:
            return
        try:
            self._counties = (await self._get(client, "/reference")).get("counties") or self._counties
            self._counties_at = time.monotonic()
        except Exception as exc:
            logger.debug("[tocsin] county names unavailable: %s", redact_text(exc))

    async def _lead_tracker(self) -> LeadTracker:
        if self._leads is None:
            state = None
            try:
                raw = await (await get_bus()).get(_LEAD_KEY)
                state = json.loads(raw) if raw else None
            except Exception as exc:
                logger.debug("[tocsin] lead tracker not restored: %s", redact_text(exc))
            self._leads = LeadTracker(state)
        return self._leads

    async def _record_alerts(self, mapped: list[dict], cap: list[dict]) -> None:
        """Lead time against Vertex's own NWS feed, and an event for each alert heard (and one when the NWS feed
        catches up), so they land in the events log, replay and webhook rules."""
        tracker = await self._lead_tracker()
        cap_events = {str(a.get("event", "")).lower() for a in cap if a.get("source") != "nwr" and not a.get("test")}
        confirmed = tracker.update(mapped, cap_events, time.time())
        for item in mapped:
            tracker.annotate(item)
        try:
            await (await get_bus()).set(_LEAD_KEY, json.dumps(tracker.state()), ex=8 * 24 * 3600)
        except Exception as exc:
            logger.debug("[tocsin] lead tracker not saved: %s", redact_text(exc))
        for item in mapped:
            if item.get("test"):
                continue
            where = f" for {item['area_desc']}" if item.get("area_desc") else ""
            await emit_event(
                "nwr_alert", None, event_severity(item),                       # no entity: events.entity_id is a foreign key
                f"{item['event']} heard on NOAA Weather Radio{where}",
                {"nwr_id": item["nwr_id"], "event": item["event"], "state": item["nwr_state"], "tier": item["nwr_tier"],
                 "callsign": item["nwr_callsign"], "area": item["area_desc"], "counties": item["nwr_counties"],
                 "cap_first": bool(item.get("nwr_cap_first"))},
                dedupe={"nwr_id": item["nwr_id"]})
        for c in confirmed:
            await emit_event(
                "nwr_alert_confirmed", None, "low",
                f"{c['event']}: Vertex's NWS feed showed it {c['lead_s']} s after the radio",
                {"nwr_id": c["nwr_id"], "event": c["event"], "lead_s": c["lead_s"]},
                dedupe={"nwr_id": c["nwr_id"]})

    async def _notice_book(self) -> "nwr_broadcast.NoticeBook":
        if self._book is None:
            state = None
            try:
                raw = await (await get_bus()).get(_NOTICE_BOOK_KEY)
                state = json.loads(raw) if raw else None
            except Exception as exc:
                logger.debug("[tocsin] notice book not restored: %s", redact_text(exc))
            self._book = nwr_broadcast.NoticeBook(state)
        return self._book

    async def _official_readings(self, lids: list[str]) -> dict[str, dict | None]:
        """NOAA's own current reading for each gauge id, from the water service. Cached; a few at a time."""
        now = time.monotonic()
        stale = [l for l in lids if l not in self._official or now - self._official[l][0] > _GAUGE_REFRESH_S]
        if stale:
            gate = asyncio.Semaphore(4)
            async with httpx.AsyncClient(timeout=15, headers=_NWS_HEADERS,
                                         event_hooks={"request": [validate_request_url]}) as client:
                async def one(lid: str) -> None:
                    async with gate:
                        reading = None
                        try:
                            resp = await client.get(_NWPS_GAUGE_URL.format(lid=lid))
                            resp.raise_for_status()
                            obs = (resp.json().get("status") or {}).get("observed") or {}
                            stage, flow = obs.get("primary"), obs.get("secondary")
                            if isinstance(stage, (int, float)) and stage > -900:
                                at = obs.get("validTime")
                                reading = {
                                    "stage_ft": float(stage),
                                    "flow_cfs": round(flow * 1000) if isinstance(flow, (int, float)) and flow > 0
                                                and str(obs.get("secondaryUnit", "")).lower() == "kcfs" else None,
                                    "at": datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() if at else None,
                                }
                        except Exception as exc:
                            logger.debug("[tocsin] NWPS %s unavailable: %s", lid, redact_text(exc))
                        self._official[lid] = (time.monotonic(), reading)
                await asyncio.gather(*(one(l) for l in stale))
        return {l: self._official.get(l, (0, None))[1] for l in lids}

    async def _seed_book(self, book: "nwr_broadcast.NoticeBook") -> None:
        """A new vote book knows only the loops in the last 40 minutes, so a notice that has been on the air for hours
        would show as just heard and with few votes. Once, replay Tocsin's stored transcripts (hours of loops)."""
        if self._seeded or book.items:
            self._seeded = True
            return
        self._seeded = True
        try:
            async with httpx.AsyncClient(timeout=30, headers=self._headers) as client:
                history = await self._get(client, "/transcripts", limit=1000)
            chunks = [t for t in history if str(t.get("event_code")) == "LIVE" and t.get("passed_guard", True)]
            book.update(nwr_broadcast.parse(chunks, await self._office_code())["notices"], time.time())
            logger.info("[tocsin] notice history seeded from %d stored chunks", len(chunks))
        except Exception as exc:
            logger.debug("[tocsin] could not seed the notice book: %s", redact_text(exc))

    async def _broadcast(self, transcripts: list[dict]) -> dict:
        """Everything parsed from the broadcast text, with notices voted across loops and each river gauge checked
        against NOAA's own reading."""
        now = time.time()
        chunks = [t for t in transcripts if str(t.get("event_code")) == "LIVE" and t.get("passed_guard", True)]
        parsed = nwr_broadcast.parse(chunks, await self._office_code())
        book = await self._notice_book()
        await self._seed_book(book)
        book.update(parsed["notices"], now)
        try:
            await (await get_bus()).set(_NOTICE_BOOK_KEY, json.dumps(book.state()), ex=7 * 24 * 3600)
        except Exception as exc:
            logger.debug("[tocsin] notice book not saved: %s", redact_text(exc))

        lids = [r["lid"] for r in parsed["rivers"] if r.get("lid")]
        official = await self._official_readings(lids)
        r = await get_bus()
        for row in parsed["rivers"]:
            row.update(nwr_broadcast.compare_river(row, official.get(row.get("lid")), now))
            row["in_vertex"] = bool(row.get("lid") and await r.exists(f"entity:nwps:gauge:{row['lid']}"))
        times = [c["timestamp_ns"] / 1e9 for c in chunks if c.get("timestamp_ns")]
        office = nwr_broadcast.Office(await self._office_code())
        home = nwr_broadcast.home_observation(parsed["observations"], office, settings.region_timezone, datetime.now(timezone.utc))
        return {
            "home": home,
            "office": await self._office_code(),
            "notices": book.current(now),
            "observations": parsed["observations"], "rivers": parsed["rivers"],
            "marine": parsed["marine"], "forecasts": parsed["forecasts"],
            "window": {"chunks": len(chunks), "from": min(times) if times else None, "to": max(times) if times else None},
            "updated": datetime.now(timezone.utc).isoformat(),
        }

    async def _refresh(self) -> None:
        async with httpx.AsyncClient(timeout=10, headers=self._headers) as client:
            await self._load_counties(client)
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
            item = normalize(alert, now, spoken.get(rf.get("raw_header"), ""), self._counties)
            if item:
                mapped.append(item)
        r0 = await get_bus()
        raw_cap = await r0.get("feed:weather:alerts")
        try:
            current = json.loads(raw_cap) if raw_cap else []
        except (json.JSONDecodeError, TypeError):
            current = []
        await self._record_alerts(mapped, [a for a in current if isinstance(a, dict)] if isinstance(current, list) else [])
        await set_feed("nwr:alerts", mapped, broadcast=False)
        await self._load_outlines(outline_ugcs(mapped))
        await set_feed("nwr:areas", build_areas(mapped, self._geom), broadcast=False)

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

        spoken_recent = recent_spoken(transcripts, _SPOKEN_SHOWN)
        try:
            await set_feed("nwr:broadcast", await self._broadcast(transcripts), broadcast=False)
        except Exception as exc:                       # a parsing problem must never take the alerts and status down
            logger.warning("[tocsin] broadcast parse failed: %s: %s", type(exc).__name__, redact_text(exc))
        mounts = [s for s in streams.get("streams", []) if s.get("on_air") is not None]
        await set_feed("nwr:status", {
            "reachable": True,
            "icecast": bool(streams.get("icecast_reachable")),
            "streams": [{"mount": s.get("mount"), "site": s.get("site"), "channel": s.get("channel"),
                         "on_air": bool(s.get("on_air")), "listeners": s.get("listeners", 0)} for s in mounts],
            "channels_dead": sorted({f'{h.get("site")}/{h.get("channel")}' for h in health if h.get("dead")}),
            "last_spoken": spoken_recent[0] if spoken_recent else None,
            "recent_spoken": spoken_recent,
            "updated": now.isoformat(),
        }, broadcast=False)
        await self._alive()
