from datetime import datetime, timezone
from typing import Optional


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
        "altitude": altitude,
        "heading": state[10],
        "speed": speed,
        "vertical_rate": vertical_rate,
        "status": "on_ground" if state[8] else "airborne",
        "last_seen": ts,
        "tags": ["aircraft"],
    }


def normalize_tar1090(ac: dict) -> Optional[dict]:
    icao = ac.get("hex", "").lower()
    if not icao or ac.get("lat") is None or ac.get("lon") is None:
        return None
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
        "altitude": ac.get("alt_baro") or ac.get("alt_geom"),
        "heading": ac.get("track"),
        "speed": ac.get("gs"),
        "vertical_rate": ac.get("baro_rate"),
        "status": "on_ground" if ac.get("on_ground") else "airborne",
        "last_seen": _now(),
        "tags": ["aircraft"],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
