import asyncio
import logging
import time
from typing import Any
import httpx
from config import settings
import json
from datetime import datetime, timezone
from bus import get_bus, publish_entity, set_aircraft_snapshot
from db import write_event
from sanitize import sanitize_payload
from enrichment.aircraft_db import AircraftDb
from enrichment.aircraft_class import classify as classify_aircraft_class, normalize_category
from enrichment.aircraft_roles import ROLES, alert_for, alert_label, classify_aircraft
from enrichment.airlines_db import AirlinesDb
from enrichment.airports_db import AirportsDb
from enrichment.adsbdb import AdsbdbClient
from enrichment.metar import MetarClient
from enrichment.navaids_db import NavaidsDb
from enrichment.route_plausibility import is_route_plausible
from .beast_transport import BeastTransport
from normalizers.beast_decoder import BeastAircraftDecoder
from normalizers.aircraft import normalize_opensky, normalize_tar1090
from normalizers.beast_math import haversine_km as _haversine_km
from .base import BasePoller
from redaction import redact_url
from security import validate_safe_url

logger = logging.getLogger(__name__)

def parse_retry_after(headers) -> int | None:
    """Seconds a rate-limited API asks us to wait: Retry-After, or OpenSky's X-Rate-Limit-Retry-After-Seconds."""
    for name in ("retry-after", "x-rate-limit-retry-after-seconds"):
        value = headers.get(name) if hasattr(headers, "get") else None
        try:
            if value is not None and int(float(value)) > 0:
                return int(float(value))
        except (TypeError, ValueError):
            continue
    return None


_SPECIAL_RESEND_S = 3 * 3600   # one event per notable aircraft per this window
_SPECIAL_MAX_KM = 150          # ignore far-away OpenSky supplements


class AdsbPoller(BasePoller):
    name = "adsb"
    interval = 5
    _MAX_OPENSKY_LOCAL_HOLDOFF_SECONDS = 90

    def __init__(self):
        self._special_seen: dict[str, float] = {}
        self._source_urls: list[str] = []
        self._beast_task: asyncio.Task | None = None
        self._registry_worker_task: asyncio.Task | None = None
        self._registry_tick_task: asyncio.Task | None = None
        self._enrichment_worker_task: asyncio.Task | None = None
        self._opensky_supplement_task: asyncio.Task | None = None
        self._beast_queue: asyncio.Queue[tuple[bytes, int, int]] = asyncio.Queue(maxsize=16384)
        self._enrichment_queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=256)
        self._pending_route_callsigns: set[str] = set()
        self._pending_aircraft_icaos: set[str] = set()
        self._pending_metar_codes: set[str] = set()
        self._beast_frames_dropped: int = 0
        self._last_seen_by_source: dict[str, dict[str, float]] = {}
        self._opensky_poll_count: int = 0
        self._opensky_backoff_seconds: int = 0
        self._opensky_token: str = ""
        self._opensky_token_expiry: float = 0.0
        self._community_task: asyncio.Task | None = None
        self._community_backoff_seconds: int = 0
        self._community_url_index: int = 0
        self._community_poll_count: int = 0
        self._last_opensky_poll_ts: float = 0.0
        self._transport = BeastTransport(on_frame=self._on_beast_frame)
        self._beast_decoder = BeastAircraftDecoder()
        self._unified_entities: dict[str, dict] = {}
        self._adsbdb = AdsbdbClient()
        self._metar = MetarClient()
        self._aircraft_db = AircraftDb()
        self._airports_db = AirportsDb()
        self._airlines_db = AirlinesDb()
        self._navaids_db = NavaidsDb()
        self._tick_count: int = 0
        self._last_source_refresh: float = 0.0

    async def setup(self):
        await self._refresh_sources()
        await self._hydrate_from_redis()

    async def _refresh_sources(self):
        from db import get_pool
        try:
            rows = await get_pool().fetch(
                "SELECT url FROM poller_sources WHERE type = 'adsb' AND enabled = TRUE"
            )
            next_urls = []
            for row in rows:
                try:
                    await validate_safe_url(row["url"], allowed_schemes={"http", "https"})
                    next_urls.append(row["url"])
                except ValueError as exc:
                    logger.warning("[adsb] blocked unsafe source %s: %s", redact_url(row["url"]), exc)
            if next_urls != self._source_urls:
                self._source_urls = next_urls
                logger.info("[adsb] %d source(s) updated", len(self._source_urls))
        except Exception as exc:
            logger.warning("[adsb] failed to refresh sources from DB: %s", exc)

    @staticmethod
    def _effective_opensky_stale_threshold() -> int:
        # Keep local tracks authoritative for at least one OpenSky cadence window
        # to reduce local↔supplement source flapping in Mode D.
        holdoff = max(settings.adsb_opensky_stale_threshold, AdsbPoller._opensky_interval() + 5)
        return min(holdoff, AdsbPoller._MAX_OPENSKY_LOCAL_HOLDOFF_SECONDS)

    async def _hydrate_from_redis(self) -> None:
        """Pre-populate the decoder registry from last-known Redis entity state.

        Prevents a blank map on poller restart while waiting for fresh BEAST CPR
        pairs to resolve (up to ~60 s for a cold start). Aircraft are seeded with
        last-known position but ``last_seen_ts=0`` so they are immediately treated
        as stale/no-fresh-data until a new fix arrives.
        """
        import json as _json
        from bus import get_bus
        from normalizers.beast_decoder import _AircraftState
        try:
            r = await get_bus()
            keys = []
            cur = 0
            while True:
                # ⚡ Bolt Optimization: Increase SCAN count to 5000 to drastically reduce round-trips
                cur, batch = await r.scan(cur, match="entity:*", count=5000)
                keys.extend(batch)
                if not cur:
                    break

            results = []
            # ⚡ Bolt Optimization: Use MGET in chunks instead of individual GETs
            for i in range(0, len(keys), 5000):
                chunk = await r.mget(keys[i:i + 5000])
                results.extend(chunk)

            hydrated = 0
            for raw in results:
                if not raw:
                    continue
                # ⚡ Bolt Optimization: Fast bytes matching to bypass JSON parsing for non-aircraft entities (~35x faster for skips)
                if isinstance(raw, bytes):
                    if b'"entity_type": "aircraft"' not in raw and b'"entity_type":"aircraft"' not in raw:
                        continue
                elif isinstance(raw, str):
                    if '"entity_type": "aircraft"' not in raw and '"entity_type":"aircraft"' not in raw:
                        continue
                try:
                    entity = _json.loads(raw)
                except Exception:
                    continue
                if entity.get("entity_type") != "aircraft":
                    continue
                lat = entity.get("lat")
                lon = entity.get("lon")
                icao = (entity.get("identity") or {}).get("icao24", "")
                if not icao or lat is None or lon is None:
                    continue
                ac = _AircraftState(icao=icao)
                ac.lat = float(lat)
                ac.lon = float(lon)
                ac.altitude = entity.get("altitude")
                ac.heading = entity.get("heading")
                ac.speed = entity.get("speed")
                ac.callsign = (entity.get("identity") or {}).get("callsign")
                ac.last_seen_ts = 0.0  # forces position_stale until a fresh fix arrives
                pos_ts = entity.get("position_ts")
                if isinstance(pos_ts, (int, float)) and pos_ts > 0:
                    # Real fix time, so decode plausibility checks scale with
                    # how long the aircraft has been out of view.
                    ac.last_position_ts = float(pos_ts)
                self._beast_decoder._aircraft[icao.lower()] = ac
                hydrated += 1
            if hydrated:
                logger.info("[adsb] hydrated %d aircraft from Redis on startup", hydrated)
        except Exception as exc:
            logger.warning("[adsb] Redis hydration failed (non-fatal): %s", exc)

    async def poll(self):
        # Refresh sources every 30s to pick up hot-reloaded config changes
        now = time.time()
        if now - self._last_source_refresh > 30:
            await self._refresh_sources()
            self._last_source_refresh = now

        # Tick loop and enrichment worker run in every mode so the snapshot and
        # stale eviction are always active (fixes the pure-OpenSky snapshot gap).
        self._ensure_support_tasks()

        if settings.adsb_enable_beast:
            self._ensure_beast_task()

        # Local HTTP polling (UltraFeeder) is a standby for BEAST: same receiver, decoded a second time
        # at 5 s resolution. Poll it only when BEAST is off or not delivering frames.
        if self._source_urls and (not settings.adsb_enable_beast or not self._transport.is_healthy):
            for url in self._source_urls:
                await self._poll_ultrafeeder(url)

        # Community feeds (airplanes.live / adsb.fi): free, no daily quota, includes owner data
        if settings.adsb_community_supplement:
            self._ensure_community_task()

        # OpenSky supplement logic (Mode D)
        if settings.adsb_opensky_supplement:
            self._ensure_opensky_supplement_task()
        elif not settings.adsb_enable_beast and not self._source_urls:
            # Fallback to pure OpenSky if no local sources are enabled/configured
            await self._poll_opensky()

    def _ensure_support_tasks(self):
        """Start the tick loop and enrichment worker — needed in every operating mode."""
        if not self._registry_tick_task or self._registry_tick_task.done():
            if self._registry_tick_task and self._registry_tick_task.exception():
                logger.warning("[adsb] registry tick task ended with error: %s", self._registry_tick_task.exception())
            self._registry_tick_task = asyncio.create_task(self._registry_tick_loop())

        if not self._enrichment_worker_task or self._enrichment_worker_task.done():
            if self._enrichment_worker_task and self._enrichment_worker_task.exception():
                logger.warning("[adsb] enrichment worker task ended with error: %s", self._enrichment_worker_task.exception())
            self._enrichment_worker_task = asyncio.create_task(self._enrichment_worker_loop())

    def _ensure_beast_task(self):
        if self._beast_task and not self._beast_task.done():
            self._ensure_frame_worker()
            return

        if self._beast_task and self._beast_task.done() and self._beast_task.exception():
            logger.warning("[adsb] BEAST task ended with error: %s", self._beast_task.exception())

        self._beast_task = asyncio.create_task(self._transport.run())
        self._ensure_frame_worker()

    def _ensure_frame_worker(self):
        """Start the BEAST frame decode worker — only needed when BEAST is active."""
        if not self._registry_worker_task or self._registry_worker_task.done():
            if self._registry_worker_task and self._registry_worker_task.exception():
                logger.warning("[adsb] registry worker task ended with error: %s", self._registry_worker_task.exception())
            self._registry_worker_task = asyncio.create_task(self._process_beast_frames())

    def _on_beast_frame(self, msg: bytes, mlat_ticks: int, signal: int) -> None:
        """Sync callback from BeastTransport; drops oldest frame if queue is full."""
        if self._beast_queue.full():
            try:
                self._beast_queue.get_nowait()
                self._beast_frames_dropped += 1
            except asyncio.QueueEmpty:
                pass
        try:
            self._beast_queue.put_nowait((msg, mlat_ticks, signal))
        except asyncio.QueueFull:
            self._beast_frames_dropped += 1

    async def _process_beast_frames(self):
        # Limit downstream DB/Redis work to at most once per second per aircraft.
        # Frames still decode into _unified_entities on every message so in-memory
        # state is always current; only the publish (Redis + DB + geofence) is gated.
        _BEAST_PUBLISH_MIN_INTERVAL = 1.0
        _last_published: dict[str, float] = {}
        count = 0

        while True:
            msg, mlat_ticks, signal = await self._beast_queue.get()
            try:
                # State-only decode: the full entity dict (trail copy, comm-B
                # snapshot, DR projection, ISO timestamp) is built lazily below,
                # only for the ≤1/s-per-aircraft publishes — not per frame.
                state = self._beast_decoder.ingest_frame(msg, mlat_ticks=mlat_ticks, signal=signal)
                # Positioned aircraft only, matching the previous behavior where
                # a position-less decode produced no entity: recording "beast"
                # for unpositioned aircraft would wrongly suppress the
                # ultrafeeder/OpenSky sources in Best Mode arbitration.
                if state is not None and state.lat is not None and state.lon is not None:
                    icao = state.icao
                    self._record_source_seen(icao, "beast")
                    now = time.time()
                    if now - _last_published.get(icao, 0.0) >= _BEAST_PUBLISH_MIN_INTERVAL:
                        entity = self._beast_decoder.entity_from_state(state, now=now)
                        if entity:
                            _last_published[icao] = now
                            self._unified_entities[icao] = entity
                            # Dead-reckoned positions are estimates — keep them out
                            # of the observation history (trails stay real fixes only).
                            await publish_entity(
                                entity,
                                record_observation=not entity.get("position_dr"),
                            )
            except Exception as exc:
                logger.warning("[adsb] frame processing error: %s", exc)

            # Periodically yield control to the asyncio event loop to prevent event loop starvation
            count += 1
            if count >= 50:
                count = 0
                await asyncio.sleep(0)

    async def _registry_tick_loop(self):
        _SNAPSHOT_INTERVAL = 5  # publish full snapshot every N ticks (seconds)

        while True:
            await asyncio.sleep(1.0)
            self._tick_count += 1
            now = time.time()

            # Hourly cleanup of stale source-tracking entries (prevents unbounded growth
            # when BEAST + ultrafeeder run without the OpenSky supplement loop).
            if self._tick_count % 3600 == 0:
                cutoff = now - 3600
                for icao in list(self._last_seen_by_source.keys()):
                    self._last_seen_by_source[icao] = {
                        src: ts for src, ts in self._last_seen_by_source[icao].items()
                        if ts > cutoff
                    }
                    if not self._last_seen_by_source[icao]:
                        del self._last_seen_by_source[icao]

            try:
                # Evict entries silent for more than 2 minutes (runs every tick, cheap)
                stale_cutoff = 120.0
                to_remove = [
                    icao for icao, entity in self._unified_entities.items()
                    if (now - max(self._last_seen_by_source.get(icao, {}).values() or [0])) > stale_cutoff
                ]
                for icao in to_remove:
                    del self._unified_entities[icao]

                # Publish full enriched snapshot at reduced cadence — individual
                # entity updates still arrive in real time via publish_entity().
                if self._tick_count % _SNAPSHOT_INTERVAL == 0:
                    # Rebuild decoder entities only here, immediately before the
                    # snapshot that consumes them — nothing reads the registry
                    # between snapshots (real-time flow goes via publish_entity),
                    # so the previous every-tick O(aircraft) rebuild was 80%
                    # wasted work. Rebuilding on the snapshot tick also keeps
                    # dead reckoning advancing through a total feed outage.
                    for ac in self._beast_decoder.snapshot_entities():
                        ac_icao = (ac.get("identity") or {}).get("icao24", "").lower()
                        self._unified_entities[ac_icao] = ac

                    snapshot_ents = [
                        entity for icao, entity in self._unified_entities.items()
                        if self._should_publish_from_source(icao, entity.get("source", "unknown"))
                    ]
                    await self._publish_aircraft_snapshot(snapshot_ents)
            except Exception as exc:
                logger.warning("[adsb] tick error: %s", exc)

    async def _enrichment_worker_loop(self):
        """Drains the bounded enrichment queue, executing one coroutine at a time."""
        while True:
            coro = await self._enrichment_queue.get()
            try:
                await coro
            except Exception as exc:
                logger.warning("[adsb] enrichment task error: %s", exc)
            finally:
                self._enrichment_queue.task_done()

    def _schedule_enrichment(self, coro: Any) -> bool:
        """Enqueue a coroutine for the supervised enrichment worker.

        Drops the item (with a warning) if the queue is full to prevent
        unbounded memory growth during high-traffic periods.
        """
        try:
            self._enrichment_queue.put_nowait(coro)
            return True
        except asyncio.QueueFull:
            logger.warning("[adsb] enrichment queue full (%d), dropping enrichment request", self._enrichment_queue.maxsize)
            coro.close()
            return False

    def _schedule_route_enrichment(self, callsign: str) -> bool:
        key = self._adsbdb.normalize_callsign(callsign)
        if not key or key in self._pending_route_callsigns:
            return False
        self._pending_route_callsigns.add(key)

        async def _lookup() -> None:
            try:
                await self._adsbdb.lookup_route(key)
            finally:
                self._pending_route_callsigns.discard(key)

        if not self._schedule_enrichment(_lookup()):
            self._pending_route_callsigns.discard(key)
            return False
        return True

    def _schedule_aircraft_enrichment(self, icao: str) -> bool:
        key = self._adsbdb.normalize_icao(icao)
        if not key or key in self._pending_aircraft_icaos:
            return False
        self._pending_aircraft_icaos.add(key)

        async def _lookup() -> None:
            try:
                await self._adsbdb.lookup_aircraft(key)
            finally:
                self._pending_aircraft_icaos.discard(key)

        if not self._schedule_enrichment(_lookup()):
            self._pending_aircraft_icaos.discard(key)
            return False
        return True

    def _schedule_metar_enrichment(self, codes: set[str]) -> bool:
        clean = {k for code in codes if (k := self._metar.normalize_icao(code))}
        todo = sorted(clean.difference(self._pending_metar_codes))
        if not todo:
            return False
        self._pending_metar_codes.update(todo)

        async def _lookup() -> None:
            try:
                await self._metar.lookup_many(todo)
            finally:
                for code in todo:
                    self._pending_metar_codes.discard(code)

        if not self._schedule_enrichment(_lookup()):
            for code in todo:
                self._pending_metar_codes.discard(code)
            return False
        return True

    async def close(self):
        """Cancel all spawned BEAST/registry tasks for clean shutdown."""
        tasks = [
            self._beast_task,
            self._registry_worker_task,
            self._registry_tick_task,
            self._enrichment_worker_task,
            self._opensky_supplement_task,
        ]
        for task in tasks:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        # Flush any un-persisted enrichment cache entries accumulated since the
        # last batch write so they survive the restart.
        self._adsbdb.flush()

    def _seed_decoder_reference(self, icao: str, entity: dict) -> None:
        """Feed another source's position into the BEAST decoder as a CPR reference.

        A seeded reference lets Tier-2 local CPR decode resolve a position from
        the very first odd/even frame when an aircraft (re-)enters SDR range,
        instead of waiting up to ~60 s for a fresh even+odd pair. The decoder
        keeps local fixes authoritative — seeds only apply when its own fix is
        missing or stale.
        """
        if not settings.adsb_enable_beast or not icao:
            return
        lat, lon = entity.get("lat"), entity.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return
        ts: float | None = None
        last_seen = entity.get("last_seen")
        if isinstance(last_seen, str):
            try:
                from datetime import datetime
                ts = datetime.fromisoformat(last_seen).timestamp()
            except ValueError:
                ts = None
        self._beast_decoder.seed_reference(icao, float(lat), float(lon), ts=ts)

    # ── Best Mode Arbitration ──────────────────────────────────────────────

    def _record_source_seen(self, icao: str, source: str) -> None:
        if not icao:
            return
        icao = icao.lower()
        if icao not in self._last_seen_by_source:
            self._last_seen_by_source[icao] = {}
        self._last_seen_by_source[icao][source] = time.time()

    def _should_publish_from_source(self, icao: str, source: str) -> bool:
        """Implements 'Best Mode' priority arbitration.

        Hierarchy: beast (1) > ultrafeeder (2) > opensky (3)
        Returns True if 'source' is currently the best available source for 'icao'.
        """
        icao = icao.lower()
        now = time.time()
        seen = self._last_seen_by_source.get(icao, {})
        priority = {"beast": 1, "ultrafeeder": 2, "community": 3, "opensky": 4}
        my_prio = priority.get(source, 99)
        for other_src, last_ts in seen.items():
            if other_src == source:
                continue
            other_prio = priority.get(other_src, 99)
            if other_prio < my_prio and (now - last_ts) < 12.0:
                return False
        return True

    def _is_community_recent(self, icao: str) -> bool:
        """True if a community feed (airplanes.live / adsb.fi) reported this aircraft within its holdoff."""
        seen_ts = self._last_seen_by_source.get(icao.lower(), {}).get("community", 0)
        return seen_ts > 0 and (time.time() - seen_ts) < self._community_holdoff()

    @staticmethod
    def _community_holdoff() -> float:
        return min(max(settings.adsb_community_stale_threshold, settings.adsb_community_interval + 5),
                   AdsbPoller._MAX_OPENSKY_LOCAL_HOLDOFF_SECONDS)

    def _is_older_than_held(self, icao: str, entity: dict) -> bool:
        """True if we already hold a newer position fix for this aircraft than `entity` carries.

        Sources report at different latencies (community ~0.3 s, OpenSky 8-60 s). A late, older fix must
        never overwrite a fresher one, or the icon jumps backwards.
        """
        held = self._unified_entities.get(icao.lower())
        held_ts = held.get("position_ts") if held else None
        new_ts = entity.get("position_ts")
        return (isinstance(held_ts, (int, float)) and isinstance(new_ts, (int, float))
                and new_ts <= held_ts)

    def _is_local_recent(self, icao: str, holdoff: float | None = None) -> bool:
        """Returns True if this aircraft was seen locally within the holdoff window."""
        icao = icao.lower()
        seen = self._last_seen_by_source.get(icao, {})
        local_ts = max(seen.get("beast", 0), seen.get("ultrafeeder", 0))
        window = self._effective_opensky_stale_threshold() if holdoff is None else holdoff
        return local_ts > 0 and (time.time() - local_ts) < window

    # ── OpenSky ───────────────────────────────────────────────────────────

    _OPENSKY_TOKEN_URL = (
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
    )
    _OPENSKY_ANON_MIN_INTERVAL = 220  # ~390 polls/day against the 400-credit anonymous budget

    async def _opensky_access_token(self, client: httpx.AsyncClient) -> str:
        """OAuth2 client-credentials bearer token (30 min lifetime), or "" when running anonymous."""
        if not (settings.adsb_opensky_client_id and settings.adsb_opensky_client_secret):
            return ""
        if self._opensky_token and time.time() < self._opensky_token_expiry:
            return self._opensky_token
        resp = await client.post(self._OPENSKY_TOKEN_URL, data={
            "grant_type": "client_credentials",
            "client_id": settings.adsb_opensky_client_id,
            "client_secret": settings.adsb_opensky_client_secret,
        })
        resp.raise_for_status()
        body = resp.json()
        self._opensky_token = body["access_token"]
        self._opensky_token_expiry = time.time() + max(int(body.get("expires_in", 1800)) - 60, 60)
        return self._opensky_token

    @staticmethod
    def _opensky_interval() -> int:
        if settings.adsb_opensky_client_id and settings.adsb_opensky_client_secret:
            return settings.adsb_opensky_interval
        return max(settings.adsb_opensky_interval, AdsbPoller._OPENSKY_ANON_MIN_INTERVAL)

    async def _fetch_opensky(self) -> dict | None:
        """Fetch the OpenSky states/all endpoint, applying auth and 429 backoff.

        Returns the parsed JSON on success, or None if rate-limited.
        """
        url = (
            "https://opensky-network.org/api/states/all"
            f"?lamin={settings.bbox_min_lat}&lamax={settings.bbox_max_lat}"
            f"&lomin={settings.bbox_min_lon}&lomax={settings.bbox_max_lon}"
        )
        headers: dict[str, str] = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

        async with httpx.AsyncClient(timeout=20) as client:
            if token := await self._opensky_access_token(client):
                headers["Authorization"] = f"Bearer {token}"
            resp = await client.get(url, headers=headers)
            if resp.status_code == 401 and token:
                self._opensky_token = ""  # expired early or revoked; refetch on the next poll

        if resp.status_code == 429:
            # OpenSky says exactly when the daily credits come back; guessing (and retrying on every
            # restart) only burns requests against a wall. Honour it, up to 12 h.
            retry_after = parse_retry_after(resp.headers)
            self._opensky_backoff_seconds = (
                min(retry_after, 12 * 3600) if retry_after
                else min(self._opensky_backoff_seconds * 2, 3600) if self._opensky_backoff_seconds else 300
            )
            logger.warning(
                "[adsb] OpenSky rate limited — backing off %ds%s",
                self._opensky_backoff_seconds, " (per Retry-After)" if retry_after else "",
            )
            return None

        resp.raise_for_status()
        self._opensky_backoff_seconds = 0
        return resp.json()

    # ── Community feeds (airplanes.live, adsb.fi) ────────────────────────────

    def _community_urls(self) -> list[str]:
        return [u.strip() for u in settings.adsb_community_urls.split(",") if u.strip()]

    def _ensure_community_task(self) -> None:
        if self._community_task and not self._community_task.done():
            return
        if self._community_task and self._community_task.done():
            if exc := self._community_task.exception():
                logger.warning("[adsb] community supplement task ended with error: %s", exc)
        logger.info("[adsb] community supplement enabled (interval=%ss, radius=%s nm, sources=%d)",
                    settings.adsb_community_interval, settings.adsb_community_radius_nm, len(self._community_urls()))
        self._community_task = asyncio.create_task(self._community_supplement_loop())

    async def _community_supplement_loop(self) -> None:
        while True:
            await asyncio.sleep(max(settings.adsb_community_interval, self._community_backoff_seconds))
            try:
                await self._poll_community_supplement()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[adsb] community supplement poll error: %s", type(exc).__name__)

    async def _fetch_community(self) -> list[dict] | None:
        """Aircraft from the first community API that answers (None if all are unavailable)."""
        urls = self._community_urls()
        if not urls:
            return None
        headers = {"User-Agent": "Vertex/1.0 (personal situational awareness dashboard)"}
        for offset in range(len(urls)):
            idx = (self._community_url_index + offset) % len(urls)
            url = urls[idx].format(lat=settings.region_lat, lon=settings.region_lon,
                                   radius=settings.adsb_community_radius_nm)
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(url, headers=headers)
                if resp.status_code == 429:
                    wait = parse_retry_after(resp.headers) or 60
                    self._community_backoff_seconds = min(wait, 900)
                    logger.warning("[adsb] community feed rate limited — waiting %ds", self._community_backoff_seconds)
                    continue
                resp.raise_for_status()
                data = resp.json()
                self._community_url_index = idx      # stay on what works
                self._community_backoff_seconds = 0
                return data.get("ac") or data.get("aircraft") or []
            except Exception as exc:
                # Never log the URL's response body; a failure here just moves on to the next source.
                logger.info("[adsb] community source %d unavailable: %s", idx, type(exc).__name__)
        return None

    async def _poll_community_supplement(self) -> None:
        aircraft = await self._fetch_community()
        if aircraft is None:
            return
        holdoff = self._community_holdoff()
        pad = 0.25    # the API returns a circle; keep what falls in (or just outside) the operating box
        published = skipped_local = outside = 0
        for ac in aircraft:
            entity = normalize_tar1090(ac, source="community")
            if not entity:
                continue
            lat, lon = entity.get("lat"), entity.get("lon")
            if not (settings.bbox_min_lat - pad <= lat <= settings.bbox_max_lat + pad
                    and settings.bbox_min_lon - pad <= lon <= settings.bbox_max_lon + pad):
                outside += 1
                continue
            icao = (entity.get("identity") or {}).get("icao24", "").lower()
            if not icao:
                continue
            self._record_source_seen(icao, "community")
            self._seed_decoder_reference(icao, entity)
            if self._is_local_recent(icao, holdoff):
                skipped_local += 1
                continue
            if self._is_older_than_held(icao, entity):
                continue
            self._unified_entities[icao] = entity
            await publish_entity(entity, record_observation=settings.adsb_community_record_observations)
            published += 1
        self._community_poll_count += 1
        if self._community_poll_count <= 3 or self._community_poll_count % 40 == 0:
            logger.info("[adsb] community poll #%d: %d published, %d seen locally, %d outside the region",
                        self._community_poll_count, published, skipped_local, outside)

    def _ensure_opensky_supplement_task(self) -> None:
        if self._opensky_supplement_task and not self._opensky_supplement_task.done():
            return
        if self._opensky_supplement_task and self._opensky_supplement_task.done():
            if exc := self._opensky_supplement_task.exception():
                logger.warning("[adsb] OpenSky supplement task ended with error: %s", exc)
        logger.info(
            "[adsb] OpenSky supplement enabled (interval=%ss, stale_threshold=%ss, effective_local_holdoff=%ss)",
            self._opensky_interval(),
            settings.adsb_opensky_stale_threshold,
            self._effective_opensky_stale_threshold(),
        )
        self._opensky_supplement_task = asyncio.create_task(self._opensky_supplement_loop())

    async def _opensky_supplement_loop(self) -> None:
        while True:
            await asyncio.sleep(max(self._opensky_interval(), self._opensky_backoff_seconds))
            try:
                await self._poll_opensky_supplement()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[adsb] OpenSky supplement poll error: %s", exc)

    async def _poll_opensky_supplement(self) -> None:
        data = await self._fetch_opensky()
        if not data:
            return
        supplemented = 0
        skipped_local = 0
        skipped_community = 0
        for state in data.get("states") or []:
            entity = normalize_opensky(state)
            if not entity:
                continue
            icao = (entity.get("identity") or {}).get("icao24")
            if icao:
                icao = icao.lower()
                self._record_source_seen(icao, "opensky")
                self._seed_decoder_reference(icao, entity)
                if self._is_local_recent(icao):
                    skipped_local += 1
                    continue
                # OpenSky only fills gaps: community fixes are ~30x fresher and carry owner data.
                if self._is_community_recent(icao) or self._is_older_than_held(icao, entity):
                    skipped_community += 1
                    continue
                self._unified_entities[icao] = entity
                await publish_entity(
                    entity,
                    record_observation=settings.adsb_opensky_record_observations,
                )
                supplemented += 1

        self._opensky_poll_count += 1
        if self._opensky_poll_count <= 3 or self._opensky_poll_count % 10 == 0:
            logger.info(
                "[adsb] OpenSky supplement poll #%d: %d published, %d seen locally, %d covered by community",
                self._opensky_poll_count,
                supplemented,
                skipped_local,
                skipped_community,
            )

    async def _poll_ultrafeeder(self, url: str):
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"})
            resp.raise_for_status()
            data = resp.json()
        for ac in data.get("aircraft", []):
            entity = normalize_tar1090(ac)
            if entity:
                icao = (entity.get("identity") or {}).get("icao24", "").lower()
                self._record_source_seen(icao, "ultrafeeder")
                self._seed_decoder_reference(icao, entity)
                # Only update the shared entity registry when ultrafeeder is the best
                # available source for this ICAO. If BEAST has been seen within the
                # freshness window, keep the BEAST-decoded entity in the registry so
                # the snapshot builder picks it up with source="beast" rather than
                # "ultrafeeder" (which would then be filtered out by arbitration).
                if self._should_publish_from_source(icao, "ultrafeeder"):
                    self._unified_entities[icao] = entity
                    await publish_entity(entity)

    async def _poll_opensky(self):
        now = time.time()
        if (now - self._last_opensky_poll_ts) < max(self._opensky_interval(), self._opensky_backoff_seconds):
            return
        self._last_opensky_poll_ts = now
        data = await self._fetch_opensky()
        if data:
            for state in data.get("states") or []:
                entity = normalize_opensky(state)
                if entity:
                    icao = (entity.get("identity") or {}).get("icao24", "").lower()
                    self._record_source_seen(icao, "opensky")
                    self._unified_entities[icao] = entity
                    await publish_entity(entity)

    async def _publish_aircraft_snapshot(self, aircraft: list[dict]):
        enriched, airports = self._enrich_aircraft_cache_only(aircraft)
        # Entities are held between snapshots, so a fix age computed when one was
        # received goes stale; recompute it so clients can anchor motion at the
        # real fix time instead of treating an old position as current.
        send_ts = time.time()
        for item in enriched:
            pos_ts = item.get("position_ts")
            if isinstance(pos_ts, (int, float)) and pos_ts > 0:
                item["position_age_s"] = round(max(0.0, send_ts - pos_ts), 1)
        positioned = sum(1 for item in enriched if isinstance(item.get("lat"), (int, float)) and isinstance(item.get("lon"), (int, float)))
        now_ts = time.time()
        beast_connected = self._beast_task is not None and not self._beast_task.done()
        last_frame_age_s = (
            now_ts - self._transport.last_frame_ts
            if self._transport.last_frame_ts > 0 else None
        )

        snapshot = {
            "schema_version": 1,
            "now": now_ts,
            "count": len(enriched),
            "positioned": positioned,
            "receiver": {
                "lat": settings.region_lat,
                "lon": settings.region_lon,
                "anon_km": 0,
            },
            "site_name": settings.region_name,
            "frames": self._transport.frames_seen,
            "frames_dropped": self._beast_frames_dropped,
            "beast_connected": beast_connected,
            "beast_healthy": self._transport.is_healthy,
            "queue_depth": self._beast_queue.qsize(),
            "last_frame_age_s": last_frame_age_s,
            "aircraft": enriched,
            "airports": airports,
        }
        await set_aircraft_snapshot(snapshot)
        await self._record_special_aircraft(enriched)

    async def _record_special_aircraft(self, enriched: list[dict]) -> None:
        """One event per notable aircraft (and per alert squawk) every few hours.

        These give the flight log a history of medical, rescue, police and fire
        flights — and an emergency squawk a place in the event stream — instead of
        living only in the current snapshot.
        """
        now = time.time()
        for key in [k for k, ts in self._special_seen.items() if now - ts > _SPECIAL_RESEND_S]:
            del self._special_seen[key]

        for entity in enriched:
            identity = entity.get("identity") or {}
            dist = entity.get("distance_km")
            if isinstance(dist, (int, float)) and dist > _SPECIAL_MAX_KM:
                continue
            icao = identity.get("icao24")
            if not icao:
                continue
            found: list[tuple[str, str, str, str]] = []   # (event_type, dedupe key, severity, summary)
            who = identity.get("callsign") or identity.get("registration") or icao
            if identity.get("role"):
                found.append((
                    "special_aircraft", f"{icao}:role", "info",
                    f"{identity.get('role_label')}: {who}"
                    + (f" ({identity.get('type') or identity.get('icao_type')})" if identity.get("type") or identity.get("icao_type") else ""),
                ))
            if identity.get("alert"):
                found.append((
                    "aircraft_alert", f"{icao}:{identity['alert']}",
                    "medium" if identity["alert"] == "radio_failure" else "high",
                    f"{who}: {alert_label(identity['alert'])}",
                ))
            for event_type, key, severity, summary in found:
                if key in self._special_seen:
                    continue
                self._special_seen[key] = now
                details = {
                    "entity_id": entity.get("entity_id"),
                    "icao24": icao,
                    "role": identity.get("role"),
                    "role_label": identity.get("role_label"),
                    "role_reason": identity.get("role_reason"),
                    "alert": identity.get("alert"),
                    "callsign": identity.get("callsign"),
                    "registration": identity.get("registration"),
                    "operator": identity.get("operator"),
                    "type": identity.get("type") or identity.get("icao_type"),
                    "squawk": identity.get("squawk"),
                    "lat": entity.get("lat"), "lon": entity.get("lon"),
                    "altitude": entity.get("altitude"),
                    "distance_km": dist,
                }
                try:
                    event_id = await write_event(event_type, entity.get("entity_id"), severity, summary, details)
                    if event_id:
                        bus = await get_bus()
                        await bus.publish("civic:updates", json.dumps(sanitize_payload({
                            "type": "event",
                            "data": {
                                "event_id": event_id, "event_type": event_type,
                                "entity_id": entity.get("entity_id"),
                                "ts": datetime.now(timezone.utc).isoformat(),
                                "severity": severity, "summary": summary, "details": details,
                            },
                        })))
                except Exception as exc:
                    logger.warning("[adsb] could not record %s for %s: %s", event_type, icao, exc)

    def _enrich_aircraft_cache_only(self, aircraft: list[dict]) -> tuple[list[dict], dict]:
        enriched: list[dict] = []
        airports: dict[str, dict] = {}
        missing_callsigns: set[str] = set()
        missing_icaos: set[str] = set()
        missing_metar_codes: set[str] = set()

        for entity in aircraft:
            identity = dict(entity.get("identity") or {})
            callsign = identity.get("callsign")
            icao = identity.get("icao24")

            route_known, route = self._adsbdb.lookup_cached_route(callsign if isinstance(callsign, str) else None)
            if route_known and route:
                origin = route.get("origin")
                destination = route.get("destination")
                if origin:
                    identity["origin"] = origin
                if destination:
                    identity["destination"] = destination
            elif callsign:
                missing_callsigns.add(str(callsign))

            ac_known, ac_meta = self._adsbdb.lookup_cached_aircraft(icao if isinstance(icao, str) else None)
            if ac_known and ac_meta:
                # Only fill what the lookup actually knows; an empty answer must not erase the
                # registration/owner a community feed or the local DB already gave us.
                identity.update({
                    k: v for k, v in {
                        "registration": ac_meta.get("registration"),
                        "type": ac_meta.get("type"),
                        "icao_type": ac_meta.get("icao_type"),
                        "manufacturer": ac_meta.get("manufacturer"),
                        "operator": ac_meta.get("operator"),
                        "operator_country": ac_meta.get("operator_country"),
                        "country_iso": ac_meta.get("country_iso"),
                    }.items() if v
                })
            elif icao:
                missing_icaos.add(str(icao))

            # Local tar1090-style aircraft DB fallback for static aircraft details.
            if isinstance(icao, str):
                # The tar1090 DB knows the registered owner/operator of ~600k aircraft with no network
                # call — this is what tells us an EMS helicopter from a private one on first sight.
                if not identity.get("operator"):
                    owner = self._aircraft_db.lookup_owner(icao)
                    if owner:
                        identity["operator"] = owner
                local_meta = self._aircraft_db.lookup(icao)
                if local_meta:
                    if not identity.get("registration") and local_meta.get("registration"):
                        identity["registration"] = local_meta.get("registration")
                    if not identity.get("icao_type") and local_meta.get("type_icao"):
                        identity["icao_type"] = local_meta.get("type_icao")
                    if not identity.get("type") and local_meta.get("type_long"):
                        identity["type"] = local_meta.get("type_long")

            # OpenFlights lookup by callsign prefix for operator/alliance fallback.
            if isinstance(callsign, str):
                airline = self._airlines_db.lookup_by_callsign(callsign)
                if airline:
                    if not identity.get("operator") and airline.get("name"):
                        identity["operator"] = airline.get("name")
                    if not identity.get("operator_country") and airline.get("country"):
                        identity["operator_country"] = airline.get("country")
                    if not identity.get("operator_iata") and airline.get("iata"):
                        identity["operator_iata"] = airline.get("iata")
                    if not identity.get("operator_alliance") and airline.get("alliance"):
                        identity["operator_alliance"] = airline.get("alliance")

            origin_info = self._airport_reference(identity.get("origin"))
            dest_info = self._airport_reference(identity.get("destination"))

            lat = entity.get("lat")
            lon = entity.get("lon")
            heading = entity.get("heading")
            plausible = is_route_plausible(
                lat=lat if isinstance(lat, (int, float)) else None,
                lon=lon if isinstance(lon, (int, float)) else None,
                origin_info=origin_info,
                dest_info=dest_info,
                heading_deg=heading if isinstance(heading, (int, float)) else None,
            )

            if not plausible:
                identity.pop("origin", None)
                identity.pop("destination", None)
                identity.pop("origin_info", None)
                identity.pop("dest_info", None)
            else:
                if origin_info:
                    identity["origin_info"] = origin_info
                else:
                    identity.pop("origin_info", None)

                if dest_info:
                    identity["dest_info"] = dest_info
                else:
                    identity.pop("dest_info", None)

            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                entity["distance_km"] = round(
                    _haversine_km(float(lat), float(lon), settings.region_lat, settings.region_lon),
                    1,
                )
            else:
                entity.pop("distance_km", None)

            identity["phase"] = self._classify_phase(entity)

            # One category format, a size/kind class that works even when the feed sent no category, and the
            # tar1090 database's military flag (independent of role: a military helicopter is both).
            category = normalize_category(identity.get("category"))
            if category:
                identity["category"] = category
            else:
                identity.pop("category", None)
            identity["aircraft_class"], _ = classify_aircraft_class(identity)
            if isinstance(icao, str) and self._aircraft_db.lookup_flags(icao) & 1:
                identity["military"] = True
            else:
                identity.pop("military", None)

            # Who flies it: air ambulance, rescue, law enforcement, ... plus emergency squawks.
            hit = classify_aircraft(identity)
            tags = [t for t in (entity.get("tags") or []) if not str(t).startswith(("role_", "alert_"))]
            if hit:
                identity["role"], identity["role_reason"] = hit
                identity["role_label"] = ROLES[hit[0]]
                tags.append(f"role_{hit[0]}")
            else:
                for k in ("role", "role_reason", "role_label"):
                    identity.pop(k, None)
            alert = alert_for(identity.get("squawk"))
            if alert:
                identity["alert"] = alert
                tags.append(f"alert_{alert}")
            else:
                identity.pop("alert", None)
            if tags:
                entity["tags"] = tags

            entity["identity"] = identity
            enriched.append(entity)

            for code_key in ("origin", "destination"):
                code = identity.get(code_key)
                if not isinstance(code, str) or len(code) != 4:
                    continue
                if code not in airports:
                    info_key = "origin_info" if code_key == "origin" else "dest_info"
                    info_obj = identity.get(info_key)
                    if isinstance(info_obj, dict):
                        airports[code] = {**info_obj, "metar": None}
                    else:
                        airports[code] = self._airport_snapshot_entry(code)
                known, metar = self._metar.lookup_cached(code)
                if known:
                    airports[code]["metar"] = metar
                else:
                    missing_metar_codes.add(code)

        # Queue-aware scheduling: cap how many new enrichments we enqueue per tick
        # to avoid burst-filling the bounded queue during heavy traffic.
        slots = max(0, self._enrichment_queue.maxsize - self._enrichment_queue.qsize())
        if slots > 0:
            metar_budget = 1 if missing_metar_codes else 0
            route_budget = max(0, (slots - metar_budget) // 2)
            aircraft_budget = max(0, slots - metar_budget - route_budget)

            routes_enqueued = 0
            for callsign in missing_callsigns:
                if routes_enqueued >= route_budget:
                    break
                if self._schedule_route_enrichment(callsign):
                    routes_enqueued += 1

            aircraft_enqueued = 0
            for icao in missing_icaos:
                if aircraft_enqueued >= aircraft_budget:
                    break
                if self._schedule_aircraft_enrichment(icao):
                    aircraft_enqueued += 1

            if missing_metar_codes:
                self._schedule_metar_enrichment(missing_metar_codes)

        return enriched, airports

    @staticmethod
    def _classify_phase(entity: dict) -> str | None:
        status = str(entity.get("status") or "")
        altitude = entity.get("altitude")
        vertical_rate = entity.get("vertical_rate")

        if status == "on_ground":
            return "taxi"

        if isinstance(vertical_rate, (int, float)):
            if vertical_rate > 500:
                return "climb"
            if vertical_rate < -500:
                return "descent"

        if isinstance(altitude, (int, float)):
            if altitude > 28000:
                return "cruise"
            if altitude < 4000:
                return "approach"

        return None

    def _airport_reference(self, code: str | None) -> dict | None:
        if not isinstance(code, str) or len(code) != 4:
            return None
        airport_info = self._airports_db.lookup(code)
        if not airport_info:
            return None

        result = {
            "icao": airport_info.get("icao") or code.upper(),
            "name": airport_info.get("name") or code.upper(),
            "city": airport_info.get("city"),
            "country": airport_info.get("country"),
            "type": airport_info.get("type"),
            "lat": airport_info.get("lat"),
            "lon": airport_info.get("lon"),
        }

        navaid = self._navaids_db.nearest(
            result.get("lat") if isinstance(result.get("lat"), (int, float)) else None,
            result.get("lon") if isinstance(result.get("lon"), (int, float)) else None,
            max_km=80.0,
        )
        if navaid:
            result["navaid"] = navaid

        return result

    def _airport_snapshot_entry(self, code: str) -> dict:
        info = self._airport_reference(code)
        if info:
            info["metar"] = None
            return info
        return {"icao": code.upper(), "name": code.upper(), "metar": None}


