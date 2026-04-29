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
        self._registry_work_queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=16384)
        self._beast_frames_seen: int = 0
        self._beast_frames_dropped: int = 0
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

    async def poll(self):
        if settings.adsb_enable_beast:
            self._ensure_beast_task()
            if self._source_urls and settings.adsb_beast_http_fallback:
                for url in self._source_urls:
                    await self._poll_ultrafeeder(url)
                return
            if not settings.adsb_beast_http_fallback:
                # BEAST-only mode: keep transport task alive and avoid HTTP/OpenSky polling.
                return

        if self._source_urls:
            for url in self._source_urls:
                await self._poll_ultrafeeder(url)
        else:
            await self._poll_opensky()

    def _ensure_beast_task(self):
        if self._beast_task and not self._beast_task.done():
            self._ensure_registry_tasks()
            return

        if self._beast_task and self._beast_task.done() and self._beast_task.exception():
            logger.warning("[adsb] BEAST task ended with error: %s", self._beast_task.exception())

        self._beast_task = asyncio.create_task(self._consume_beast())
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

    async def _process_registry_work(self):
        while True:
            kind, payload = await self._registry_work_queue.get()
            try:
                if kind == "frame":
                    msg, mlat_ticks, signal = payload
                    entity = self._beast_decoder.ingest(msg, mlat_ticks=mlat_ticks, signal=signal)
                    if entity:
                        await publish_entity(entity)
                elif kind == "tick":
                    await self._publish_aircraft_snapshot(self._beast_decoder.snapshot_entities())
            except Exception as exc:
                logger.warning("[adsb] registry work processing error (%s): %s", kind, exc)

    async def _registry_tick_loop(self):
        while True:
            await asyncio.sleep(1.0)
            self._enqueue_registry_work("tick", None)

    async def _consume_beast(self):
        backoff = max(1, settings.adsb_beast_reconnect_initial_seconds)
        max_backoff = max(backoff, settings.adsb_beast_reconnect_max_seconds)
        host = settings.adsb_beast_host
        port = settings.adsb_beast_port

        while True:
            writer = None
            try:
                reader, writer = await asyncio.open_connection(host, port)
                logger.info("[adsb] BEAST connected to %s:%s", host, port)
                backoff = max(1, settings.adsb_beast_reconnect_initial_seconds)
                buffer = bytearray()

                while True:
                    chunk = await reader.read(4096)
                    if not chunk:
                        raise ConnectionError("BEAST stream closed")
                    buffer.extend(chunk)
                    consumed, messages = self._consume_beast_buffer(buffer)
                    if consumed:
                        del buffer[:consumed]
                    if messages:
                        self._beast_frames_seen += len(messages)
                        for msg, mlat_ticks, signal in messages:
                            self._enqueue_registry_work("frame", (msg, mlat_ticks, signal))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[adsb] BEAST connection error: %s (retry in %ss)", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)
            finally:
                try:
                    if writer is not None:
                        writer.close()
                        await writer.wait_closed()
                except Exception:
                    pass

    def _consume_beast_buffer(self, buffer: bytearray) -> tuple[int, list[tuple[bytes, int, int]]]:
        pos = 0
        messages: list[tuple[bytes, int, int]] = []

        while pos < len(buffer):
            consumed, message = self._parse_one_beast_frame(memoryview(buffer)[pos:])
            if consumed == 0:
                break
            if consumed < 0:
                pos += abs(consumed)
                continue
            pos += consumed
            if message:
                messages.append(message)

        return pos, messages

    def _parse_one_beast_frame(self, view: memoryview) -> tuple[int, tuple[bytes, int, int] | None]:
        if len(view) < 2:
            return 0, None
        if view[0] != 0x1A:
            next_sync = bytes(view[1:]).find(b"\x1a")
            if next_sync < 0:
                return -len(view), None
            return -(next_sync + 1), None

        frame_type = view[1]
        payload_len = {0x31: 2, 0x32: 7, 0x33: 14}.get(frame_type)
        if payload_len is None:
            return -1, None

        needed = 6 + 1 + payload_len
        i = 2
        filled = 0
        body = bytearray(needed)

        while filled < needed:
            if i >= len(view):
                return 0, None
            b = view[i]
            if b == 0x1A:
                if i + 1 >= len(view):
                    return 0, None
                if view[i + 1] == 0x1A:
                    body[filled] = 0x1A
                    i += 2
                    filled += 1
                else:
                    return -i, None
            else:
                body[filled] = b
                i += 1
                filled += 1

        if frame_type not in (0x32, 0x33):
            return i, None

        mlat_ticks = int.from_bytes(body[0:6], byteorder="big", signed=False)
        signal = int(body[6])
        message = bytes(body[7 : 7 + payload_len])
        return i, (message, mlat_ticks, signal)

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

        if aircraft:
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

        if aircraft:
            await self._publish_aircraft_snapshot(aircraft)

    async def _publish_aircraft_snapshot(self, aircraft: list[dict]):
        enriched, airports = self._enrich_aircraft_cache_only(aircraft)
        positioned = sum(1 for item in enriched if isinstance(item.get("lat"), (int, float)) and isinstance(item.get("lon"), (int, float)))

        snapshot = {
            "now": time.time(),
            "count": len(enriched),
            "positioned": positioned,
            "receiver": {
                "lat": settings.region_lat,
                "lon": settings.region_lon,
                "anon_km": 0,
            },
            "site_name": settings.region_name,
            "frames": self._beast_frames_seen,
            "frames_dropped": self._beast_frames_dropped,
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
            asyncio.create_task(self._adsbdb.lookup_route(callsign))

        for icao in missing_icaos:
            asyncio.create_task(self._adsbdb.lookup_aircraft(icao))

        if missing_metar_codes:
            asyncio.create_task(self._metar.lookup_many(sorted(missing_metar_codes)))

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
