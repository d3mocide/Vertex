"""
TinyGS poller — connects to the TinyGS cloud MQTT broker and receives real-time
satellite reception events from the user's local ground station.

TinyGS stations publish to mqtt.tinygs.com:8883 (TLS). This poller subscribes
to the same broker using the station owner's MQTT credentials (obtained from the
TinyGS Telegram bot via /mqtt), receiving every event the station publishes.

Topic layout:
  tinygs/<username>/tele/rx       fired on every satellite packet received
  tinygs/<username>/tele/welcome  fired on station boot
  tinygs/<username>/tele/ping     periodic keep-alive (battery, heap)
  tinygs/<username>/stat/status   modem config / heartbeat

Satellite positions are propagated from TLEs fetched from CelesTrak using the
NORAD ID in each rx message. TLEs are cached for 3 hours.

Required env vars:
  TINYGS_MQTT_USERNAME   TinyGS MQTT username (usually your Telegram username)
  TINYGS_MQTT_PASSWORD   TinyGS MQTT password  (from /mqtt in the Telegram bot)
"""

import asyncio
import datetime
import json
import logging
import math
import ssl
import time

import httpx

from bus import publish_entity
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_MQTT_HOST = "mqtt.tinygs.com"
_MQTT_PORT = 8883
_TLE_TTL = 3 * 3600        # refresh TLEs every 3 hours
_STATION_TTL = 300         # station entity expires after 5 min without ping
_SAT_TTL = 1800            # satellite entity visible for 30 min after last rx
_RETRY_DELAY = 15
_MAX_RETRY_DELAY = 300
_CELESTRAK = "https://celestrak.org/SPACETRACK/query/class/tle/CATNR/{norad}/format/tle/"


# ---------------------------------------------------------------------------
# Coordinate maths (no extra deps — sgp4 ECI → WGS84 geodetic)
# ---------------------------------------------------------------------------

def _eci_to_geodetic(r_eci: tuple, unix_ts: float) -> tuple[float, float, float]:
    """Convert ECI position (km) to WGS84 (lat_deg, lon_deg, alt_m)."""
    x, y, z = r_eci
    a = 6378.137
    f = 1 / 298.257223563
    e2 = 2 * f - f * f

    jd = unix_ts / 86400.0 + 2440587.5
    T = (jd - 2451545.0) / 36525.0
    gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + T * T * (0.000387933 - T / 38710000.0)) % 360.0
    g = math.radians(gmst)

    xe = x * math.cos(g) + y * math.sin(g)
    ye = -x * math.sin(g) + y * math.cos(g)
    ze = z

    lon = math.degrees(math.atan2(ye, xe))
    p = math.sqrt(xe ** 2 + ye ** 2)
    lat = math.degrees(math.atan2(ze, p * (1 - e2)))
    for _ in range(5):
        lr = math.radians(lat)
        N = a / math.sqrt(1 - e2 * math.sin(lr) ** 2)
        lat = math.degrees(math.atan2(ze + e2 * N * math.sin(lr), p))
    lr = math.radians(lat)
    N = a / math.sqrt(1 - e2 * math.sin(lr) ** 2)
    if abs(lat) < 89.9:
        alt_km = p / math.cos(lr) - N
    else:
        alt_km = abs(ze) / abs(math.sin(lr)) - N * (1 - e2)

    return lat, lon, alt_km * 1000.0


def _propagate(tle1: str, tle2: str, unix_ts: float) -> tuple[float, float, float] | None:
    """Return (lat_deg, lon_deg, alt_m) or None if propagation fails."""
    try:
        from sgp4.api import Satrec, jday  # type: ignore[import]
        sat = Satrec.twoline2rv(tle1, tle2)
        dt = datetime.datetime.fromtimestamp(unix_ts, tz=datetime.timezone.utc)
        jd, fr = jday(dt.year, dt.month, dt.day,
                      dt.hour, dt.minute, dt.second + dt.microsecond / 1e6)
        err, r, _ = sat.sgp4(jd, fr)
        if err != 0:
            return None
        return _eci_to_geodetic(r, unix_ts)
    except Exception as exc:
        logger.debug("[tinygs] sgp4 propagation error: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Poller
# ---------------------------------------------------------------------------

class TinyGSPoller(BasePoller):
    name = "tinygs"
    interval = 60

    def __init__(self):
        self._tle_cache: dict[int, dict] = {}
        self._station: dict | None = None   # last known station entity
        self._logged_tls_guidance = False

    async def poll(self):
        pass  # streaming — run() is overridden

    async def run(self):
        if not (settings.tinygs_mqtt_username and settings.tinygs_mqtt_password):
            logger.info(
                "[tinygs] disabled — set TINYGS_MQTT_USERNAME and TINYGS_MQTT_PASSWORD"
            )
            return

        logger.info("[tinygs] started, targeting mqtt://%s:%d", _MQTT_HOST, _MQTT_PORT)
        retry_delay = _RETRY_DELAY
        while True:
            try:
                await self._connect_and_listen()
                retry_delay = _RETRY_DELAY
            except Exception as exc:
                if self._is_tls_cert_error(exc) and not self._logged_tls_guidance:
                    self._logged_tls_guidance = True
                    logger.error(
                        "[tinygs] TLS verification failed for %s. TinyGS is presenting a certificate chain not trusted by the default CA store. "
                        "Set TINYGS_CA_CERT_PATH to a PEM bundle containing the TinyGS CA, or set TINYGS_TLS_INSECURE=true only if you accept disabling certificate verification.",
                        _MQTT_HOST,
                    )
                logger.warning("[tinygs] MQTT error: %s — retry in %ds", exc, retry_delay)
                await self._heartbeat("error", str(exc)[:256])
                retry_delay = min(retry_delay * 2, _MAX_RETRY_DELAY)
            await asyncio.sleep(retry_delay)

    async def _connect_and_listen(self):
        import aiomqtt  # type: ignore[import]

        tls_ctx = self._build_tls_context()
        user = settings.tinygs_mqtt_username
        topic = f"tinygs/{user}/#"

        async with aiomqtt.Client(
            hostname=_MQTT_HOST,
            port=_MQTT_PORT,
            tls_context=tls_ctx,
            username=user,
            password=settings.tinygs_mqtt_password,
            keepalive=60,
        ) as client:
            await client.subscribe(topic)
            logger.info("[tinygs] MQTT connected — subscribed to %s", topic)
            await self._heartbeat("ok")

            async for message in client.messages:
                try:
                    await self._dispatch(str(message.topic), message.payload)
                    await self._heartbeat("ok")
                except Exception as exc:
                    logger.debug("[tinygs] message handler error: %s", exc)

    def _build_tls_context(self) -> ssl.SSLContext:
        if settings.tinygs_tls_insecure:
            ctx = ssl._create_unverified_context()
            logger.warning("[tinygs] TLS certificate verification disabled by TINYGS_TLS_INSECURE")
            return ctx

        ctx = ssl.create_default_context()
        if settings.tinygs_ca_cert_path:
            ctx.load_verify_locations(cafile=settings.tinygs_ca_cert_path)
        return ctx

    def _is_tls_cert_error(self, exc: BaseException) -> bool:
        current: BaseException | None = exc
        seen: set[int] = set()
        while current and id(current) not in seen:
            seen.add(id(current))
            if isinstance(current, ssl.SSLCertVerificationError):
                return True
            text = str(current)
            if "CERTIFICATE_VERIFY_FAILED" in text or "unable to get local issuer certificate" in text:
                return True
            current = current.__cause__ or current.__context__
        return False

    # ------------------------------------------------------------------
    # Message dispatch
    # ------------------------------------------------------------------

    async def _dispatch(self, topic: str, payload: bytes):
        parts = topic.split("/")
        if len(parts) < 4:
            return
        msg_type = "/".join(parts[2:])   # e.g. "tele/rx", "stat/status"

        try:
            data = json.loads(payload)
        except Exception:
            return

        if msg_type == "tele/rx":
            await self._on_rx(data)
        elif msg_type in ("tele/welcome", "stat/status"):
            await self._on_station(data)
        elif msg_type == "tele/ping":
            await self._on_ping(data)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def _on_rx(self, data: dict):
        """Satellite packet received — create/update satellite entity."""
        sat_name = data.get("satellite") or "Unknown"
        norad_id = data.get("NORAD")
        rx_ts = float(data.get("unix_GS_time") or time.time())
        loc = data.get("station_location") or []

        if len(loc) >= 2:
            await self._upsert_station_location(float(loc[0]), float(loc[1]))

        lat, lon, alt_m = None, None, None
        if norad_id:
            pos = await self._satellite_position(int(norad_id), rx_ts)
            if pos:
                lat, lon, alt_m = pos

        entity = {
            "entity_id": f"tinygs:sat:{norad_id or sat_name}",
            "entity_type": "satellite",
            "source": "tinygs",
            "display_name": sat_name,
            "lat": lat,
            "lon": lon,
            "altitude": alt_m,
            "status": "received",
            "identity": {
                "satellite_name": sat_name,
                "norad_id": norad_id,
                "frequency_hz": data.get("frequency"),
                "mode": data.get("mode"),
                "spreading_factor": data.get("sf"),
                "coding_rate": data.get("cr"),
                "bandwidth_hz": data.get("bw"),
                "rssi": data.get("rssi"),
                "snr": data.get("snr"),
                "frequency_error_hz": data.get("frequency_error"),
                "doppler_hz": data.get("f_doppler"),
                "crc_ok": not bool(data.get("crc_error")),
                "raw_data_b64": data.get("data"),
                "last_rx_ts": rx_ts,
                "received_by": settings.tinygs_mqtt_username,
            },
            "tags": ["tinygs", "satellite", "lora"],
        }
        await publish_entity(entity, ttl=_SAT_TTL)

    async def _on_station(self, data: dict):
        """Boot / modem-config message — upsert ground station entity."""
        loc = data.get("station_location") or []
        lat = float(loc[0]) if len(loc) >= 2 else None
        lon = float(loc[1]) if len(loc) >= 2 else None
        name = settings.tinygs_mqtt_username

        entity = {
            "entity_id": f"tinygs:station:{name}",
            "entity_type": "tinygs_station",
            "source": "tinygs",
            "display_name": f"TinyGS {name}",
            "lat": lat,
            "lon": lon,
            "status": "online",
            "identity": {
                "station_name": name,
                "firmware": data.get("version"),
                "board": data.get("board"),
                "ip": data.get("ip"),
                "current_satellite": data.get("satellite"),
                "frequency_hz": data.get("frequency"),
                "mode": data.get("mode"),
                "spreading_factor": data.get("sf"),
                "coding_rate": data.get("cr"),
                "bandwidth_hz": data.get("bw"),
                "battery_v": data.get("Vbat"),
                "heap_free_b": data.get("heap"),
            },
            "tags": ["tinygs", "ground_station"],
        }
        self._station = entity
        await publish_entity(entity, ttl=_STATION_TTL)

    async def _on_ping(self, data: dict):
        """Keep-alive — update station housekeeping fields without a full retransmit."""
        if not self._station:
            return
        entity = dict(self._station)
        identity = dict(entity.get("identity") or {})
        identity["battery_v"] = data.get("Vbat")
        identity["heap_free_b"] = data.get("heap")
        identity["wifi_rssi"] = data.get("RSSI")
        entity["identity"] = identity
        self._station = entity
        await publish_entity(entity, ttl=_STATION_TTL)

    async def _upsert_station_location(self, lat: float, lon: float):
        """Patch lat/lon into cached station entity when embedded in an rx message."""
        if self._station and (self._station.get("lat") is None):
            self._station = {**self._station, "lat": lat, "lon": lon}

    # ------------------------------------------------------------------
    # TLE fetch + satellite propagation
    # ------------------------------------------------------------------

    async def _satellite_position(
        self, norad_id: int, unix_ts: float
    ) -> tuple[float, float, float] | None:
        tle = await self._get_tle(norad_id)
        if not tle:
            return None
        return _propagate(tle[0], tle[1], unix_ts)

    async def _get_tle(self, norad_id: int) -> tuple[str, str] | None:
        cached = self._tle_cache.get(norad_id)
        if cached and time.time() - cached["ts"] < _TLE_TTL:
            return cached["tle1"], cached["tle2"]

        url = _CELESTRAK.format(norad=norad_id)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                lines = [ln.strip() for ln in resp.text.splitlines() if ln.strip()]
                # CelesTrak returns 2-line (no name) or 3-line (with name) TLE
                tle1, tle2 = lines[-2], lines[-1]
                if tle1.startswith("1 ") and tle2.startswith("2 "):
                    self._tle_cache[norad_id] = {"tle1": tle1, "tle2": tle2, "ts": time.time()}
                    logger.debug("[tinygs] cached TLE for NORAD %d", norad_id)
                    return tle1, tle2
        except Exception as exc:
            logger.debug("[tinygs] TLE fetch failed for NORAD %d: %s", norad_id, exc)
        return None
