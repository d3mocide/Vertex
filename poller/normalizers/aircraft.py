from datetime import datetime, timezone
from typing import Optional


OPENSKY_POSITION_STALE_SECONDS = 30


def normalize_opensky(state: list) -> Optional[dict]:
    # OpenSky states array:
    # [icao24, callsign, origin_country, time_position, last_contact,
    #  longitude, latitude, baro_altitude, on_ground, velocity,
    #  true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
    if len(state) < 7 or state[6] is None or state[5] is None:
        return None
    icao = state[0].lower()
    ts_epoch = state[3] or state[4]
    ts = datetime.fromtimestamp(ts_epoch, tz=timezone.utc).isoformat() if ts_epoch else _now()
    now_epoch = datetime.now(timezone.utc).timestamp()
    position_stale = ts_epoch is None or (now_epoch - float(ts_epoch)) > OPENSKY_POSITION_STALE_SECONDS

    raw_alt = state[7]
    altitude = raw_alt / 0.3048 if raw_alt is not None else None

    raw_speed = state[9]
    speed = raw_speed / 0.514444 if raw_speed is not None else None

    raw_vr = state[11]
    vertical_rate = raw_vr / 0.3048 * 60 if raw_vr is not None else None

    return {
        "entity_id": f"aircraft:{icao}",
        "entity_type": "aircraft",
        "source": "opensky",
        "display_name": (state[1] or "").strip() or icao.upper(),
        "identity": {
            "icao24": icao,
            "callsign": (state[1] or "").strip(),
            "origin_country": state[2],
            "squawk": state[14] if len(state) > 14 else None,
        },
        "lat": state[6],
        "lon": state[5],
        "position_stale": position_stale,
        "altitude": altitude,
        "heading": state[10],
        "speed": speed,
        "vertical_rate": vertical_rate,
        "status": "on_ground" if state[8] else "airborne",
        "last_seen": ts,
        "tags": ["aircraft"],
    }


TAR1090_POSITION_STALE_SECONDS = 10
TAR1090_POSITION_MAX_AGE_SECONDS = 60


def _numeric_or_none(value) -> Optional[float]:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def normalize_tar1090(ac: dict) -> Optional[dict]:
    icao = ac.get("hex", "").lower()
    if not icao or ac.get("lat") is None or ac.get("lon") is None:
        return None

    # tar1090/readsb signals ground via alt_baro == "ground" (there is no
    # on_ground key in the aircraft.json schema); accept both for robustness.
    on_ground = ac.get("alt_baro") == "ground" or bool(ac.get("on_ground"))
    altitude = _numeric_or_none(ac.get("alt_baro"))
    if altitude is None:
        altitude = _numeric_or_none(ac.get("alt_geom"))

    # seen_pos = seconds since the last position fix. Skip aircraft whose fix is
    # ancient (readsb retains them for minutes) and flag moderately old ones so
    # the frontend freezes extrapolation instead of projecting stale motion.
    seen_pos = _numeric_or_none(ac.get("seen_pos"))
    if seen_pos is not None and seen_pos > TAR1090_POSITION_MAX_AGE_SECONDS:
        return None
    position_stale = seen_pos is not None and seen_pos > TAR1090_POSITION_STALE_SECONDS

    return {
        "entity_id": f"aircraft:{icao}",
        "entity_type": "aircraft",
        "source": "ultrafeeder",
        "display_name": ac.get("flight", "").strip() or icao.upper(),
        "identity": {
            "icao24": icao,
            "callsign": ac.get("flight", "").strip(),
            "squawk": ac.get("squawk"),
            "category": ac.get("category"),
        },
        "lat": ac.get("lat"),
        "lon": ac.get("lon"),
        "position_stale": position_stale,
        "position_age_s": seen_pos,
        "altitude": altitude,
        "heading": _numeric_or_none(ac.get("track")),
        "speed": _numeric_or_none(ac.get("gs")),
        "vertical_rate": _numeric_or_none(ac.get("baro_rate")),
        "status": "on_ground" if on_ground else "airborne",
        "last_seen": _now(),
        "tags": ["aircraft"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
