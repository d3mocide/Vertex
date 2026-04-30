from __future__ import annotations

import logging
import math
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from config import settings

try:
    import pyModeS as pms
except Exception:  # pragma: no cover - runtime dependency guard
    pms = None

logger = logging.getLogger(__name__)


# Maximum number of historical positions to keep per aircraft.
# Matches frontend TRAIL_CAP so the server and client are in sync.
_POS_HISTORY_CAP = 150


@dataclass
class _AircraftState:
    icao: str
    callsign: Optional[str] = None
    category: Optional[str] = None
    squawk: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None
    vertical_rate: Optional[float] = None
    on_ground: Optional[bool] = None
    even_msg: Optional[str] = None
    odd_msg: Optional[str] = None
    even_ts: Optional[float] = None
    odd_ts: Optional[float] = None
    last_position_ts: Optional[float] = None
    last_mlat_ticks: Optional[int] = None
    signal_peak: Optional[int] = None
    msg_count: int = 0
    last_seen_ts: float = 0.0

    # Ring buffer of recent resolved positions: (lat, lon, alt_ft, unix_ts)
    # Oldest entries are dropped automatically when maxlen is reached.
    pos_history: deque = field(
        default_factory=lambda: deque(maxlen=_POS_HISTORY_CAP)
    )

    # Comm-B/EHS state (best-effort)
    selected_altitude_mcp_ft: Optional[float] = None
    selected_altitude_fms_ft: Optional[float] = None
    qnh_hpa: Optional[float] = None
    bds40_at: Optional[float] = None

    wind_speed_kt: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    static_air_temperature_c: Optional[float] = None
    static_pressure_hpa: Optional[float] = None
    turbulence: Optional[int] = None
    humidity_pct: Optional[float] = None
    bds44_at: Optional[float] = None

    roll_deg: Optional[float] = None
    true_track_deg: Optional[float] = None
    groundspeed_kt: Optional[float] = None
    track_rate_deg_per_s: Optional[float] = None
    true_airspeed_kt: Optional[float] = None
    bds50_at: Optional[float] = None

    magnetic_heading_deg: Optional[float] = None
    indicated_airspeed_kt: Optional[float] = None
    mach: Optional[float] = None
    baro_vertical_rate_fpm: Optional[float] = None
    inertial_vertical_rate_fpm: Optional[float] = None
    bds60_at: Optional[float] = None

    comm_b_raw: dict[str, str] = field(default_factory=dict)


class BeastAircraftDecoder:
    """Best-effort ADS-B decode pipeline for BEAST Mode S messages.

    This decoder focuses on DF17/DF18 ADS-B messages and maintains minimal
    state for CPR pair position resolution.
    """

    def __init__(self):
        self._aircraft: dict[str, _AircraftState] = {}
        self._warned_missing_dep = False
        self._messages_seen = 0

    def ingest(self, message_bytes: bytes, *, mlat_ticks: int | None = None, signal: int | None = None) -> Optional[dict]:
        if pms is None:
            if not self._warned_missing_dep:
                logger.warning("[adsb] pyModeS not available; BEAST decode disabled")
                self._warned_missing_dep = True
            return None

        hex_msg = message_bytes.hex().upper()
        if len(hex_msg) not in (14, 28):
            return None

        try:
            df = pms.df(hex_msg)
        except Exception:
            return None

        if df not in (4, 5, 11, 17, 18, 20, 21):
            return None

        try:
            icao = (pms.icao(hex_msg) or "").lower()
        except Exception:
            return None

        if not icao:
            return None

        now = time.time()
        ac = self._aircraft.get(icao)
        if ac is None:
            ac = _AircraftState(icao=icao)
            self._aircraft[icao] = ac
        ac.last_seen_ts = now
        ac.msg_count += 1
        if mlat_ticks is not None:
            ac.last_mlat_ticks = int(mlat_ticks)
        if signal is not None:
            signal_int = int(signal)
            ac.signal_peak = signal_int if ac.signal_peak is None else max(ac.signal_peak, signal_int)

        typecode = self._safe(lambda: pms.adsb.typecode(hex_msg))
        if df in (17, 18):
            if typecode is None:
                return None

            if 1 <= typecode <= 4:
                callsign = self._safe(lambda: pms.adsb.callsign(hex_msg))
                if isinstance(callsign, str):
                    ac.callsign = _normalize_callsign(callsign)
                category = self._safe(lambda: pms.adsb.category(hex_msg))
                if category is not None:
                    ac.category = str(category)

            if 5 <= typecode <= 8:
                ac.on_ground = True
                self._update_cpr(ac, hex_msg, now)

            if 9 <= typecode <= 22:
                if typecode <= 18 or typecode >= 20:
                    ac.on_ground = False
                alt = self._safe(lambda: pms.adsb.altitude(hex_msg))
                if alt is not None:
                    ac.altitude = float(alt)
                self._update_cpr(ac, hex_msg, now)

            if typecode == 19:
                vel = self._safe(lambda: pms.adsb.velocity(hex_msg))
                if isinstance(vel, tuple) and len(vel) >= 3:
                    spd, trk, vr = vel[0], vel[1], vel[2]
                    if spd is not None:
                        ac.speed = float(spd)
                    if trk is not None:
                        ac.heading = float(trk)
                    if vr is not None:
                        ac.vertical_rate = float(vr)

        if df in (4, 20):
            alt = self._decode_altitude_reply(hex_msg)
            if alt is not None:
                ac.altitude = alt

        if df in (5, 21):
            squawk = self._decode_squawk_reply(hex_msg)
            if squawk:
                ac.squawk = squawk

        if df in (20, 21):
            self._decode_comm_b(ac, message_bytes, now)

        # DF11 presence updates ICAO/last_seen only.

        self._messages_seen += 1
        if self._messages_seen % 1000 == 0:
            self._prune_stale()

        return self._to_entity(ac)

    def snapshot_entities(self, stale_seconds: int = 60) -> list[dict]:
        now = time.time()
        result: list[dict] = []
        for ac in self._aircraft.values():
            if (now - ac.last_seen_ts) > stale_seconds:
                continue
            entity = self._to_entity(ac, now=now)
            if entity:
                result.append(entity)
        return result

    def _update_cpr(self, ac: _AircraftState, hex_msg: str, now: float):
        resolved_lat: float | None = None
        resolved_lon: float | None = None

        oe = self._safe(lambda: pms.adsb.oe_flag(hex_msg))
        if oe == 0:
            ac.even_msg = hex_msg
            ac.even_ts = now
        elif oe == 1:
            ac.odd_msg = hex_msg
            ac.odd_ts = now

        # Tier 1: global CPR with even+odd pair.
        if ac.even_msg and ac.odd_msg and ac.even_ts and ac.odd_ts and abs(ac.even_ts - ac.odd_ts) <= 10:
            latlon = self._safe(lambda: pms.adsb.position(ac.even_msg, ac.odd_msg, ac.even_ts, ac.odd_ts))
            if isinstance(latlon, tuple) and len(latlon) == 2:
                lat, lon = latlon
                if lat is not None and lon is not None:
                    resolved_lat = float(lat)
                    resolved_lon = float(lon)

        # Tier 2: local CPR decode against aircraft last known position.
        if resolved_lat is None and ac.lat is not None and ac.lon is not None:
            latlon = self._safe(lambda: pms.adsb.position_with_ref(hex_msg, ac.lat, ac.lon))
            if isinstance(latlon, tuple) and len(latlon) == 2:
                lat, lon = latlon
                if lat is not None and lon is not None:
                    resolved_lat = float(lat)
                    resolved_lon = float(lon)

        # Tier 3: local CPR decode against configured receiver reference.
        if resolved_lat is None:
            latlon = self._safe(lambda: pms.adsb.position_with_ref(hex_msg, settings.region_lat, settings.region_lon))
            if isinstance(latlon, tuple) and len(latlon) == 2:
                lat, lon = latlon
                if lat is not None and lon is not None:
                    resolved_lat = float(lat)
                    resolved_lon = float(lon)

        if resolved_lat is None or resolved_lon is None:
            return

        candidate_lat = resolved_lat
        candidate_lon = resolved_lon

        # Drop geographically implausible jumps from occasional decode noise.
        if ac.lat is not None and ac.lon is not None:
            elapsed_seconds = max(0.0, now - (ac.last_position_ts or now))
            budget_km = max(10.0, elapsed_seconds * 0.5)
            distance_km = _haversine_km(ac.lat, ac.lon, candidate_lat, candidate_lon)
            if distance_km > budget_km:
                return

            # Heading-consistency guard: if the aircraft has a known track and the
            # candidate position lies in a direction that's >90° off from that track,
            # it is almost certainly a bad Tier-2/3 CPR decode (position is in the
            # right CPR zone but on the wrong "cell"). Reject it.
            # Skip this check when the aircraft is slow or on the ground (heading
            # is unreliable at low speeds).
            if (
                distance_km > 0.1
                and ac.heading is not None
                and ac.speed is not None
                and ac.speed > 50  # knots — ignore heading at low taxi speed
            ):
                candidate_bearing = _bearing_deg(ac.lat, ac.lon, candidate_lat, candidate_lon)
                angle_diff = abs((candidate_bearing - ac.heading + 180) % 360 - 180)
                if angle_diff > 90:
                    return

        ac.lat = candidate_lat
        ac.lon = candidate_lon
        ac.last_position_ts = now

        # Record this resolved position in the ring buffer.
        # alt_ft may be None if the aircraft hasn't sent an altitude message yet.
        ac.pos_history.append((
            candidate_lat,
            candidate_lon,
            ac.altitude if ac.altitude is not None else 0.0,
            now,
        ))

    def _to_entity(self, ac: _AircraftState, now: float | None = None) -> Optional[dict]:
        if ac.lat is None or ac.lon is None:
            return None

        now_ts = now if isinstance(now, (int, float)) else time.time()
        last_seen = datetime.now(timezone.utc).isoformat()
        callsign = _normalize_callsign(ac.callsign)

        # Always display at the last actual CPR-fixed position.
        # Dead reckoning (projecting forward with heading+speed) was previously
        # used here but caused the icon to drift away from the trail_pts ring
        # buffer, producing a "floating trail" artifact that rotated as the map
        # was panned.  The frontend already renders a dashed predicted-path layer
        # from the current heading/speed — that is sufficient for smooth UX.
        display_lat = ac.lat
        display_lon = ac.lon
        position_stale = (
            ac.last_position_ts is not None
            and (now_ts - ac.last_position_ts) > 10.0
        )

        comm_b = self._build_comm_b_snapshot(ac, now_ts)

        # Serialise position history as a compact list of [lat, lon, alt_ft, unix_ts].
        # The frontend uses this to seed a dense trail immediately rather than
        # waiting to accumulate points one-per-second client-side.
        trail_pts = [
            [p[0], p[1], p[2], p[3]]
            for p in ac.pos_history
        ]

        return {
            "entity_id": f"aircraft:{ac.icao}",
            "entity_type": "aircraft",
            "source": "beast",
            "display_name": callsign or ac.icao.upper(),
            "identity": {
                "icao24": ac.icao,
                "callsign": callsign,
                "squawk": ac.squawk,
                "category": ac.category,
            },
            "lat": display_lat,
            "lon": display_lon,
            "position_stale": position_stale,
            "altitude": ac.altitude,
            "heading": ac.heading,
            "speed": ac.speed,
            "vertical_rate": ac.vertical_rate,
            "signal_peak": ac.signal_peak,
            "msg_count": ac.msg_count,
            "mlat_ticks": ac.last_mlat_ticks,
            "comm_b": comm_b,
            "status": "on_ground" if ac.on_ground else "airborne",
            "last_seen": last_seen,
            "tags": ["aircraft"],
            "trail_pts": trail_pts,
        }

    def _decode_altitude_reply(self, hex_msg: str) -> Optional[float]:
        alt = self._safe(lambda: pms.altcode(hex_msg))
        if alt is None:
            alt = self._safe(lambda: pms.common.altcode(hex_msg))
        if isinstance(alt, (int, float)):
            return float(alt)
        return None

    def _decode_squawk_reply(self, hex_msg: str) -> Optional[str]:
        sq = self._safe(lambda: pms.idcode(hex_msg))
        if sq is None:
            sq = self._safe(lambda: pms.common.idcode(hex_msg))
        if isinstance(sq, str) and sq.strip():
            return sq.strip()
        if isinstance(sq, (int, float)):
            try:
                return f"{int(sq):04d}"
            except Exception:
                return None
        return None

    def _decode_comm_b(self, ac: _AircraftState, message_bytes: bytes, now: float):
        if len(message_bytes) != 14:
            return

        payload = message_bytes[4:11]
        bds = _infer_bds(payload)
        if not bds:
            return

        ac.comm_b_raw[bds] = payload.hex().upper()

        if bds == "4,0":
            values = _decode_bds40(payload)
            if values:
                ac.selected_altitude_mcp_ft = values.get("selected_altitude_mcp_ft")
                ac.selected_altitude_fms_ft = values.get("selected_altitude_fms_ft")
                ac.qnh_hpa = values.get("qnh_hpa")
                ac.bds40_at = now
        elif bds == "4,4":
            values = _decode_bds44(payload)
            if values:
                ac.wind_speed_kt = values.get("wind_speed_kt")
                ac.wind_direction_deg = values.get("wind_direction_deg")
                ac.static_air_temperature_c = values.get("static_air_temperature_c")
                ac.static_pressure_hpa = values.get("static_pressure_hpa")
                ac.turbulence = values.get("turbulence")
                ac.humidity_pct = values.get("humidity_pct")
                ac.bds44_at = now
        elif bds == "5,0":
            values = _decode_bds50(payload)
            if values:
                ac.roll_deg = values.get("roll_deg")
                ac.true_track_deg = values.get("true_track_deg")
                ac.groundspeed_kt = values.get("groundspeed_kt")
                ac.track_rate_deg_per_s = values.get("track_rate_deg_per_s")
                ac.true_airspeed_kt = values.get("true_airspeed_kt")
                ac.bds50_at = now
        elif bds == "6,0":
            values = _decode_bds60(payload)
            if values:
                ac.magnetic_heading_deg = values.get("magnetic_heading_deg")
                ac.indicated_airspeed_kt = values.get("indicated_airspeed_kt")
                ac.mach = values.get("mach")
                ac.baro_vertical_rate_fpm = values.get("baro_vertical_rate_fpm")
                ac.inertial_vertical_rate_fpm = values.get("inertial_vertical_rate_fpm")
                ac.bds60_at = now

    def _build_comm_b_snapshot(self, ac: _AircraftState, now_ts: float) -> Optional[dict]:
        max_age = 120.0

        def fresh(ts: float | None) -> bool:
            return ts is not None and (now_ts - ts) <= max_age

        sat = ac.static_air_temperature_c if fresh(ac.bds44_at) else None
        sat_source = "observed" if sat is not None else None

        # Derive SAT from TAS+Mach when direct BDS4,4 temperature is unavailable.
        if sat is None and fresh(ac.bds50_at) and fresh(ac.bds60_at) and ac.true_airspeed_kt and ac.mach:
            try:
                speed_of_sound = (float(ac.true_airspeed_kt) * 0.514444) / float(ac.mach)
                temp_k = (speed_of_sound**2) / 401.874
                if 150.0 <= temp_k <= 320.0:
                    sat = temp_k - 273.15
                    sat_source = "derived"
            except Exception:
                sat = None
                sat_source = None

        tat = None
        if sat is not None and ac.mach is not None:
            tat = sat + (0.2 * float(ac.mach) ** 2) * (sat + 273.15) - 273.15

        snapshot = {
            "selected_altitude_mcp_ft": ac.selected_altitude_mcp_ft if fresh(ac.bds40_at) else None,
            "selected_altitude_fms_ft": ac.selected_altitude_fms_ft if fresh(ac.bds40_at) else None,
            "qnh_hpa": ac.qnh_hpa if fresh(ac.bds40_at) else None,
            "wind_speed_kt": ac.wind_speed_kt if fresh(ac.bds44_at) else None,
            "wind_direction_deg": ac.wind_direction_deg if fresh(ac.bds44_at) else None,
            "static_air_temperature_c": sat,
            "static_air_temperature_source": sat_source,
            "total_air_temperature_c": tat,
            "static_pressure_hpa": ac.static_pressure_hpa if fresh(ac.bds44_at) else None,
            "turbulence": ac.turbulence if fresh(ac.bds44_at) else None,
            "humidity_pct": ac.humidity_pct if fresh(ac.bds44_at) else None,
            "roll_deg": ac.roll_deg if fresh(ac.bds50_at) else None,
            "true_track_deg": ac.true_track_deg if fresh(ac.bds50_at) else None,
            "groundspeed_kt": ac.groundspeed_kt if fresh(ac.bds50_at) else None,
            "track_rate_deg_per_s": ac.track_rate_deg_per_s if fresh(ac.bds50_at) else None,
            "true_airspeed_kt": ac.true_airspeed_kt if fresh(ac.bds50_at) else None,
            "magnetic_heading_deg": ac.magnetic_heading_deg if fresh(ac.bds60_at) else None,
            "indicated_airspeed_kt": ac.indicated_airspeed_kt if fresh(ac.bds60_at) else None,
            "mach": ac.mach if fresh(ac.bds60_at) else None,
            "baro_vertical_rate_fpm": ac.baro_vertical_rate_fpm if fresh(ac.bds60_at) else None,
            "inertial_vertical_rate_fpm": ac.inertial_vertical_rate_fpm if fresh(ac.bds60_at) else None,
            "raw": dict(ac.comm_b_raw),
        }

        if all(value is None for key, value in snapshot.items() if key != "raw") and not snapshot["raw"]:
            return None
        return snapshot

    def _prune_stale(self, stale_seconds: int = 600):
        now = time.time()
        stale = [icao for icao, ac in self._aircraft.items() if (now - ac.last_seen_ts) > stale_seconds]
        for icao in stale:
            self._aircraft.pop(icao, None)

    @staticmethod
    def _safe(fn):
        try:
            return fn()
        except Exception:
            return None


def _normalize_callsign(callsign: str | None) -> str:
    if not callsign:
        return ""
    return callsign.rstrip("_ ").strip()


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


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the initial bearing (0–360°) from (lat1,lon1) to (lat2,lon2)."""
    φ1 = math.radians(lat1)
    φ2 = math.radians(lat2)
    Δλ = math.radians(lon2 - lon1)
    Δψ = math.log(math.tan(φ2 / 2 + math.pi / 4) / math.tan(φ1 / 2 + math.pi / 4))
    θ = math.atan2(Δλ, Δψ) * 180 / math.pi
    return (θ + 360) % 360


def _project_position(
    lat: float,
    lon: float,
    heading_deg: float | None,
    speed_kt: float | None,
    elapsed_seconds: float,
) -> tuple[float, float] | None:
    if heading_deg is None or speed_kt is None:
        return None
    if speed_kt <= 0 or elapsed_seconds <= 0:
        return None

    distance_km = float(speed_kt) * 0.000514444 * float(elapsed_seconds)
    if distance_km <= 0:
        return None

    earth_radius_km = 6371.0088
    angular_distance = distance_km / earth_radius_km

    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    brng = math.radians(float(heading_deg) % 360.0)

    sin_lat2 = math.sin(lat1) * math.cos(angular_distance) + math.cos(lat1) * math.sin(angular_distance) * math.cos(brng)
    lat2 = math.asin(max(-1.0, min(1.0, sin_lat2)))
    lon2 = lon1 + math.atan2(
        math.sin(brng) * math.sin(angular_distance) * math.cos(lat1),
        math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
    )

    lat_deg = math.degrees(lat2)
    lon_deg = ((math.degrees(lon2) + 540.0) % 360.0) - 180.0
    return lat_deg, lon_deg


def _infer_bds(payload: bytes) -> str | None:
    if len(payload) != 7:
        return None
    bds1 = (payload[0] >> 4) & 0x0F
    bds2 = payload[0] & 0x0F
    code = f"{bds1},{bds2}"
    if code in {"4,0", "4,4", "5,0", "6,0"}:
        return code
    return None


def _bits(payload: bytes) -> str:
    return "".join(f"{b:08b}" for b in payload)


def _u(bitstr: str, start: int, length: int) -> int:
    return int(bitstr[start : start + length], 2)


def _s(bitstr: str, start: int, length: int) -> int:
    raw = _u(bitstr, start, length)
    sign = 1 << (length - 1)
    return (raw ^ sign) - sign


def _clamp(value: float | None, low: float, high: float) -> float | None:
    if value is None:
        return None
    if value < low or value > high:
        return None
    return value


def _decode_bds40(payload: bytes) -> dict:
    b = _bits(payload)
    mcp = _u(b, 1, 12) * 16.0
    fms = _u(b, 14, 12) * 16.0
    qnh = 800.0 + (_u(b, 27, 11) * 0.1)
    return {
        "selected_altitude_mcp_ft": _clamp(mcp, 0.0, 60000.0),
        "selected_altitude_fms_ft": _clamp(fms, 0.0, 60000.0),
        "qnh_hpa": _clamp(qnh, 850.0, 1100.0),
    }


def _decode_bds44(payload: bytes) -> dict:
    b = _bits(payload)
    wind_speed = float(_u(b, 8, 9))
    wind_dir = (_u(b, 17, 9) * 360.0) / 512.0
    sat = _s(b, 26, 10) * 0.25
    pressure = 800.0 + (_u(b, 36, 11) * 0.1)
    turbulence = _u(b, 47, 3)
    humidity = _u(b, 50, 6) * (100.0 / 63.0)
    return {
        "wind_speed_kt": _clamp(wind_speed, 0.0, 300.0),
        "wind_direction_deg": _clamp(wind_dir, 0.0, 360.0),
        "static_air_temperature_c": _clamp(sat, -100.0, 60.0),
        "static_pressure_hpa": _clamp(pressure, 850.0, 1100.0),
        "turbulence": int(turbulence),
        "humidity_pct": _clamp(humidity, 0.0, 100.0),
    }


def _decode_bds50(payload: bytes) -> dict:
    b = _bits(payload)
    roll = _s(b, 0, 10) * 0.1
    true_track = (_u(b, 10, 10) * 360.0) / 1024.0
    groundspeed = float(_u(b, 20, 10))
    track_rate = _s(b, 30, 10) * 0.05
    tas = float(_u(b, 40, 10))
    return {
        "roll_deg": _clamp(roll, -90.0, 90.0),
        "true_track_deg": _clamp(true_track, 0.0, 360.0),
        "groundspeed_kt": _clamp(groundspeed, 0.0, 700.0),
        "track_rate_deg_per_s": _clamp(track_rate, -20.0, 20.0),
        "true_airspeed_kt": _clamp(tas, 0.0, 700.0),
    }


def _decode_bds60(payload: bytes) -> dict:
    b = _bits(payload)
    mag_hdg = (_u(b, 0, 10) * 360.0) / 1024.0
    ias = float(_u(b, 10, 10))
    mach = _u(b, 20, 10) / 512.0
    baro_vr = _s(b, 30, 10) * 64.0
    inertial_vr = _s(b, 40, 10) * 64.0
    return {
        "magnetic_heading_deg": _clamp(mag_hdg, 0.0, 360.0),
        "indicated_airspeed_kt": _clamp(ias, 0.0, 700.0),
        "mach": _clamp(mach, 0.0, 1.5),
        "baro_vertical_rate_fpm": _clamp(baro_vr, -8000.0, 8000.0),
        "inertial_vertical_rate_fpm": _clamp(inertial_vr, -8000.0, 8000.0),
    }
