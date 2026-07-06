import asyncio
import logging
import time
from typing import Any
import httpx
from config import settings
from bus import publish_entity, set_aircraft_snapshot
from enrichment.aircraft_db import AircraftDb
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

logger = logging.getLogger(__name__)


class AdsbPoller(BasePoller):
    name = "adsb"
    interval = 5
    _MAX_OPENSKY_LOCAL_HOLDOFF_SECONDS = 90

    def __init__(self):
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
            next_urls = [row["url"] for row in rows]
            if next_urls != self._source_urls:
                self._source_urls = next_urls
                logger.info("[adsb] sources updated: %s", self._source_urls)
        except Exception as exc:
            logger.warning("[adsb] failed to refresh sources from DB: %s", exc)

    @staticmethod
    def _effective_opensky_stale_threshold() -> int:
        # Keep local tracks authoritative for at least one OpenSky cadence window
        # to reduce local↔supplement source flapping in Mode D.
        holdoff = max(settings.adsb_opensky_stale_threshold, settings.adsb_opensky_interval + 5)
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

        # Concurrent local HTTP polling (UltraFeeder)
        if self._source_urls:
            for url in self._source_urls:
                await self._poll_ultrafeeder(url)

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
                entity = self._beast_decoder.ingest(msg, mlat_ticks=mlat_ticks, signal=signal)
                if entity:
                    icao = (entity.get("identity") or {}).get("icao24", "").lower()
                    self._record_source_seen(icao, "beast")
                    self._unified_entities[icao] = entity
                    now = time.time()
                    if now - _last_published.get(icao, 0.0) >= _BEAST_PUBLISH_MIN_INTERVAL:
                        _last_published[icao] = now
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
        _last_frames_seen = self._transport.frames_seen

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
                # Pull fresh BEAST positions into the unified registry when new
                # frames have arrived since the last tick — skips the O(aircraft)
                # entity reconstruction when the decoder state is unchanged.
                # Also refresh on every snapshot tick regardless: dead-reckoned
                # display positions advance with wall-clock time, so a total
                # feed gap must not freeze the published snapshot.
                current_frames = self._transport.frames_seen
                if current_frames != _last_frames_seen or self._tick_count % _SNAPSHOT_INTERVAL == 0:
                    _last_frames_seen = current_frames
                    for ac in self._beast_decoder.snapshot_entities():
                        icao = (ac.get("identity") or {}).get("icao24", "").lower()
                        self._unified_entities[icao] = ac

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
        priority = {"beast": 1, "ultrafeeder": 2, "opensky": 3}
        my_prio = priority.get(source, 99)
        for other_src, last_ts in seen.items():
            if other_src == source:
                continue
            other_prio = priority.get(other_src, 99)
            if other_prio < my_prio and (now - last_ts) < 12.0:
                return False
        return True

    def _is_local_recent(self, icao: str) -> bool:
        """Returns True if this aircraft was seen locally within the holdoff window."""
        icao = icao.lower()
        seen = self._last_seen_by_source.get(icao, {})
        local_ts = max(seen.get("beast", 0), seen.get("ultrafeeder", 0))
        return local_ts > 0 and (time.time() - local_ts) < self._effective_opensky_stale_threshold()

    # ── OpenSky ───────────────────────────────────────────────────────────

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
        if settings.adsb_opensky_username and settings.adsb_opensky_password:
            import base64
            creds = f"{settings.adsb_opensky_username}:{settings.adsb_opensky_password}"
            headers["Authorization"] = f"Basic {base64.b64encode(creds.encode()).decode()}"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=headers)

        if resp.status_code == 429:
            self._opensky_backoff_seconds = (
                min(self._opensky_backoff_seconds * 2, 3600)
                if self._opensky_backoff_seconds else 300
            )
            logger.warning(
                "[adsb] OpenSky rate limited — backing off %ds",
                self._opensky_backoff_seconds,
            )
            return None

        resp.raise_for_status()
        self._opensky_backoff_seconds = 0
        return resp.json()

    def _ensure_opensky_supplement_task(self) -> None:
        if self._opensky_supplement_task and not self._opensky_supplement_task.done():
            return
        if self._opensky_supplement_task and self._opensky_supplement_task.done():
            if exc := self._opensky_supplement_task.exception():
                logger.warning("[adsb] OpenSky supplement task ended with error: %s", exc)
        logger.info(
            "[adsb] OpenSky supplement enabled (interval=%ss, stale_threshold=%ss, effective_local_holdoff=%ss)",
            settings.adsb_opensky_interval,
            settings.adsb_opensky_stale_threshold,
            self._effective_opensky_stale_threshold(),
        )
        self._opensky_supplement_task = asyncio.create_task(self._opensky_supplement_loop())

    async def _opensky_supplement_loop(self) -> None:
        while True:
            await asyncio.sleep(max(settings.adsb_opensky_interval, self._opensky_backoff_seconds))
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
                self._unified_entities[icao] = entity
                await publish_entity(
                    entity,
                    record_observation=settings.adsb_opensky_record_observations,
                )
                supplemented += 1

        self._opensky_poll_count += 1
        if self._opensky_poll_count <= 3 or self._opensky_poll_count % 10 == 0:
            logger.info(
                "[adsb] OpenSky supplement poll #%d: %d published, %d skipped (seen locally)",
                self._opensky_poll_count,
                supplemented,
                skipped_local,
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
        if (now - self._last_opensky_poll_ts) < max(settings.adsb_opensky_interval, self._opensky_backoff_seconds):
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
                identity.update({
                    "registration": ac_meta.get("registration"),
                    "type": ac_meta.get("type"),
                    "icao_type": ac_meta.get("icao_type"),
                    "manufacturer": ac_meta.get("manufacturer"),
                    "operator": ac_meta.get("operator"),
                    "operator_country": ac_meta.get("operator_country"),
                    "country_iso": ac_meta.get("country_iso"),
                })
            elif icao:
                missing_icaos.add(str(icao))

            # Local tar1090-style aircraft DB fallback for static aircraft details.
            if isinstance(icao, str):
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


