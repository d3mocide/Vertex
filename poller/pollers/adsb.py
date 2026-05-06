import asyncio
import logging
import math
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
from .base import BasePoller

logger = logging.getLogger(__name__)


class AdsbPoller(BasePoller):
    name = "adsb"
    interval = 5

    def __init__(self):
        self._source_urls: list[str] = []
        self._beast_task: asyncio.Task | None = None
        self._registry_worker_task: asyncio.Task | None = None
        self._registry_tick_task: asyncio.Task | None = None
        self._enrichment_worker_task: asyncio.Task | None = None
        self._opensky_supplement_task: asyncio.Task | None = None
        self._registry_work_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=16384)
        self._enrichment_queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=256)
        self._beast_frames_dropped: int = 0
        self._local_seen: dict[str, float] = {}  # icao24 → last local seen timestamp
        self._transport = BeastTransport(on_frame=self._enqueue_beast_frame)
        self._beast_decoder = BeastAircraftDecoder()
        self._adsbdb = AdsbdbClient()
        self._metar = MetarClient()
        self._aircraft_db = AircraftDb()
        self._airports_db = AirportsDb()
        self._airlines_db = AirlinesDb()
        self._navaids_db = NavaidsDb()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'adsb' AND enabled = TRUE"
        )
        self._source_urls = [row["url"] for row in rows]
        if self._source_urls:
            logger.info("[adsb] %d local source(s): %s", len(self._source_urls), self._source_urls)
        else:
            logger.info("[adsb] no local sources configured — falling back to OpenSky")
        await self._hydrate_from_redis()

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
            keys = await r.keys("entity:*")
            hydrated = 0
            for key in keys:
                raw = await r.get(key)
                if not raw:
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
        if settings.adsb_enable_beast:
            self._ensure_beast_task()
            # HTTP fires only when BEAST hasn't delivered a frame recently.
            # This is a true fallback: one source active at a time.
            if self._source_urls and not self._transport.is_healthy:
                logger.info("[adsb] BEAST unhealthy — HTTP fallback active")
                for url in self._source_urls:
                    await self._poll_ultrafeeder(url)
            if settings.adsb_opensky_supplement and self._source_urls:
                self._ensure_opensky_supplement_task()
            return

        if self._source_urls:
            for url in self._source_urls:
                await self._poll_ultrafeeder(url)
            if settings.adsb_opensky_supplement:
                self._ensure_opensky_supplement_task()
        else:
            await self._poll_opensky()

    def _ensure_beast_task(self):
        if self._beast_task and not self._beast_task.done():
            self._ensure_registry_tasks()
            return

        if self._beast_task and self._beast_task.done() and self._beast_task.exception():
            logger.warning("[adsb] BEAST task ended with error: %s", self._beast_task.exception())

        self._beast_task = asyncio.create_task(self._transport.run())
        self._ensure_registry_tasks()

    def _ensure_registry_tasks(self):
        if not self._registry_worker_task or self._registry_worker_task.done():
            if self._registry_worker_task and self._registry_worker_task.exception():
                logger.warning("[adsb] registry worker task ended with error: %s", self._registry_worker_task.exception())
            self._registry_worker_task = asyncio.create_task(self._process_registry_work())

        if not self._registry_tick_task or self._registry_tick_task.done():
            if self._registry_tick_task and self._registry_tick_task.exception():
                logger.warning("[adsb] registry tick task ended with error: %s", self._registry_tick_task.exception())
            self._registry_tick_task = asyncio.create_task(self._registry_tick_loop())

        if not self._enrichment_worker_task or self._enrichment_worker_task.done():
            if self._enrichment_worker_task and self._enrichment_worker_task.exception():
                logger.warning("[adsb] enrichment worker task ended with error: %s", self._enrichment_worker_task.exception())
            self._enrichment_worker_task = asyncio.create_task(self._enrichment_worker_loop())

    def _enqueue_beast_frame(self, msg: bytes, mlat_ticks: int, signal: int) -> None:
        """Callback wired into BeastTransport; routes frames to the registry queue."""
        self._enqueue_registry_work("frame", (msg, mlat_ticks, signal))

    async def _process_registry_work(self):
        while True:
            kind, payload = await self._registry_work_queue.get()
            try:
                if kind == "frame":
                    msg, mlat_ticks, signal = payload
                    entity = self._beast_decoder.ingest(msg, mlat_ticks=mlat_ticks, signal=signal)
                    if entity:
                        await publish_entity(entity)
                        self._record_local_seen(entity)
                elif kind == "tick":
                    snapshot_ents = self._beast_decoder.snapshot_entities()
                    await self._publish_aircraft_snapshot(snapshot_ents)
                    # Refresh local_seen for every non-stale aircraft in the snapshot.
                    now = time.time()
                    for ent in snapshot_ents:
                        if not ent.get("position_stale"):
                            icao = (ent.get("identity") or {}).get("icao24")
                            if icao:
                                self._local_seen[icao.lower()] = now
            except Exception as exc:
                logger.warning("[adsb] registry work processing error (%s): %s", kind, exc)

    async def _registry_tick_loop(self):
        while True:
            await asyncio.sleep(1.0)
            self._enqueue_registry_work("tick", None)

    async def _enrichment_worker_loop(self):
        """Drains the bounded enrichment queue, executing one coroutine at a time.

        This replaces fire-and-forget asyncio.create_task() for enrichment calls,
        ensuring failures are logged and the task count is controlled.
        """
        while True:
            coro = await self._enrichment_queue.get()
            try:
                await coro
            except Exception as exc:
                logger.warning("[adsb] enrichment task error: %s", exc)
            finally:
                self._enrichment_queue.task_done()

    def _schedule_enrichment(self, coro: Any) -> None:
        """Enqueue a coroutine for the supervised enrichment worker.

        Drops the item (with a warning) if the queue is full to prevent
        unbounded memory growth during high-traffic periods.
        """
        try:
            self._enrichment_queue.put_nowait(coro)
        except asyncio.QueueFull:
            logger.warning("[adsb] enrichment queue full (%d), dropping enrichment request", self._enrichment_queue.maxsize)
            coro.close()

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

    def _enqueue_registry_work(self, kind: str, payload: Any):
        if self._registry_work_queue.full():
            try:
                dropped_kind, _ = self._registry_work_queue.get_nowait()
                if dropped_kind == "frame":
                    self._beast_frames_dropped += 1
            except asyncio.QueueEmpty:
                pass
        try:
            self._registry_work_queue.put_nowait((kind, payload))
        except asyncio.QueueFull:
            if kind == "frame":
                self._beast_frames_dropped += 1

    # ── Local sighting tracking (Mode D) ─────────────────────────────────────

    def _record_local_seen(self, entity: dict) -> None:
        icao = (entity.get("identity") or {}).get("icao24")
        if icao:
            self._local_seen[icao.lower()] = time.time()

    def _is_local_recent(self, icao: str) -> bool:
        ts = self._local_seen.get(icao.lower())
        if ts is None:
            return False
        return (time.time() - ts) < settings.adsb_opensky_stale_threshold

    # ── OpenSky supplement task (Mode D) ─────────────────────────────────────

    def _ensure_opensky_supplement_task(self) -> None:
        if self._opensky_supplement_task and not self._opensky_supplement_task.done():
            return
        if self._opensky_supplement_task and self._opensky_supplement_task.done():
            if exc := self._opensky_supplement_task.exception():
                logger.warning("[adsb] OpenSky supplement task ended with error: %s", exc)
        self._opensky_supplement_task = asyncio.create_task(self._opensky_supplement_loop())

    async def _opensky_supplement_loop(self) -> None:
        while True:
            await asyncio.sleep(settings.adsb_opensky_interval)
            # Purge _local_seen entries well beyond the stale window to prevent growth.
            cutoff = time.time() - settings.adsb_opensky_stale_threshold * 10
            self._local_seen = {k: v for k, v in self._local_seen.items() if v > cutoff}
            try:
                await self._poll_opensky_supplement()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[adsb] OpenSky supplement poll error: %s", exc)

    async def _poll_opensky_supplement(self) -> None:
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
            logger.warning("[adsb] OpenSky supplement rate limited — backing off 60s")
            await asyncio.sleep(60)
            return
        resp.raise_for_status()
        data = resp.json()

        supplemented = 0
        skipped_local = 0
        for state in data.get("states") or []:
            entity = normalize_opensky(state)
            if not entity:
                continue
            icao = (entity.get("identity") or {}).get("icao24")
            if icao and self._is_local_recent(icao):
                skipped_local += 1
                continue
            await publish_entity(
                entity,
                record_observation=settings.adsb_opensky_record_observations,
            )
            supplemented += 1

        logger.debug(
            "[adsb] OpenSky supplement: %d published, %d skipped (seen locally)",
            supplemented, skipped_local,
        )

    async def _poll_ultrafeeder(self, url: str):
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"})
            resp.raise_for_status()
            data = resp.json()
        aircraft: list[dict] = []
        for ac in data.get("aircraft", []):
            entity = normalize_tar1090(ac)
            if entity:
                aircraft.append(entity)
                await publish_entity(entity)
                self._record_local_seen(entity)

        # Always publish a snapshot, including empty lists, so stale aircraft
        # do not linger in Redis/frontend when upstream temporarily returns none.
        await self._publish_aircraft_snapshot(aircraft)

    async def _poll_opensky(self):
        url = (
            "https://opensky-network.org/api/states/all"
            f"?lamin={settings.bbox_min_lat}&lamax={settings.bbox_max_lat}"
            f"&lomin={settings.bbox_min_lon}&lomax={settings.bbox_max_lon}"
        )
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url)
        if resp.status_code == 429:
            logger.warning("[adsb] OpenSky rate limited — backing off 60s")
            await asyncio.sleep(60)
            return
        resp.raise_for_status()
        data = resp.json()
        aircraft: list[dict] = []
        for state in data.get("states") or []:
            entity = normalize_opensky(state)
            if entity:
                aircraft.append(entity)
                await publish_entity(entity)

        # Always publish a snapshot, including empty lists, so stale aircraft
        # do not linger in Redis/frontend when upstream temporarily returns none.
        await self._publish_aircraft_snapshot(aircraft)

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
            "queue_depth": self._registry_work_queue.qsize(),
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

        for callsign in missing_callsigns:
            self._schedule_enrichment(self._adsbdb.lookup_route(callsign))

        for icao in missing_icaos:
            self._schedule_enrichment(self._adsbdb.lookup_aircraft(icao))

        if missing_metar_codes:
            self._schedule_enrichment(self._metar.lookup_many(sorted(missing_metar_codes)))

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


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0088

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat_rad = math.radians(lat2 - lat1)
    dlon_rad = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat_rad / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon_rad / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c
