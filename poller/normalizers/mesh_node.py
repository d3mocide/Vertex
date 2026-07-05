from datetime import datetime, timezone
from typing import Optional


def snr_to_quality(snr) -> float | None:
    """Convert SNR (dB) to a normalised signal quality in [0, 1]."""
    if snr is None:
        return None
    try:
        return max(0.0, min(1.0, (float(snr) + 20) / 30))
    except (TypeError, ValueError):
        return None


_CONTACT_TYPES = {
    0: "unknown",
    1: "client",
    2: "repeater",
    3: "room",
    4: "sensor",
}


def normalize_pymc_repeater_advert(data: dict, source_url: str) -> Optional[dict]:
    """Normalize a pyMC-Repeater advert to a canonical mesh_node entity."""
    pub_key = (data.get("public_key") or "").strip()
    if not pub_key or pub_key == "0" * 64:
        return None

    name = (data.get("name") or "").strip() or pub_key[:12]

    contact_type_raw = data.get("contact_type") or data.get("type") or 0
    if isinstance(contact_type_raw, int):
        contact_type = _CONTACT_TYPES.get(contact_type_raw, "unknown")
    else:
        contact_type = str(contact_type_raw)

    lat = data.get("gps_lat") or data.get("lat") or data.get("latitude")
    lon = data.get("gps_lon") or data.get("lon") or data.get("longitude")
    if lat == 0.0 and lon == 0.0:
        lat = lon = None

    last_advert = data.get("last_advert_timestamp") or data.get("lastmod")
    if isinstance(last_advert, (int, float)):
        last_seen = datetime.fromtimestamp(last_advert, tz=timezone.utc).isoformat()
    else:
        last_seen = _now()

    out_path_len = data.get("out_path_len")
    status = f"hops:{out_path_len}" if out_path_len is not None else ""

    return {
        "entity_id":    f"mesh_node:{pub_key}",
        "entity_type":  "mesh_node",
        "source":       "meshcore",
        "display_name": name,
        "identity": {
            "public_key":   pub_key,
            "node_id":      pub_key[:12],
            "short_name":   name[:12],
            "contact_type": contact_type,
            "source_url":   source_url,
            "out_path":     data.get("out_path"),
            "out_path_len": out_path_len,
        },
        "lat":      lat,
        "lon":      lon,
        "altitude": None,
        "status":   status,
        "last_seen": last_seen,
        "tags":     ["mesh_node", contact_type],
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
