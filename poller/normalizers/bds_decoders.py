"""Best-effort BDS (Comm-B Data Selector) register decoders for Mode S EHS."""
from __future__ import annotations



def infer_bds(payload: bytes) -> str | None:
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


def decode_bds40(payload: bytes) -> dict:
    b = _bits(payload)
    mcp = _u(b, 1, 12) * 16.0
    fms = _u(b, 14, 12) * 16.0
    qnh = 800.0 + (_u(b, 27, 11) * 0.1)
    return {
        "selected_altitude_mcp_ft": _clamp(mcp, 0.0, 60000.0),
        "selected_altitude_fms_ft": _clamp(fms, 0.0, 60000.0),
        "qnh_hpa": _clamp(qnh, 850.0, 1100.0),
    }


def decode_bds44(payload: bytes) -> dict:
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


def decode_bds50(payload: bytes) -> dict:
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


def decode_bds60(payload: bytes) -> dict:
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
