import base64
import hashlib
import json
import logging

import httpx

from bus import publish_entity
from .base import BasePoller

logger = logging.getLogger(__name__)

AMTRAK_URL = "https://maps.amtrak.org/services/MapDataService/trains/getTrainsData"

# Master segment from Amtrak's bundled JavaScript (maps.amtrak.org).
# If decryption starts failing, grab the current value by searching the bundle
# for 'MASTER_SEGMENT' or the UUID pattern after the 'p' key construction.
_MASTER_SEGMENT = "88b6be4c-11ad-4a80-b5a1-de08bbda79b2"

# Oregon + SW Washington bounding box — wider than metro config so we catch
# trains approaching from California, Idaho, and Washington.
_MIN_LAT, _MAX_LAT = 41.9, 47.0
_MIN_LON, _MAX_LON = -124.6, -116.4

_COMPASS = {
    "N": 0, "NNE": 22.5, "NE": 45, "ENE": 67.5,
    "E": 90, "ESE": 112.5, "SE": 135, "SSE": 157.5,
    "S": 180, "SSW": 202.5, "SW": 225, "WSW": 247.5,
    "W": 270, "WNW": 292.5, "NW": 315, "NNW": 337.5,
}


def _safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _direction_to_heading(direction: str | None) -> float | None:
    if not direction:
        return None
    return _COMPASS.get(str(direction).strip().upper())


def _decrypt_amtrak(s_field: str, p_field: str) -> list:
    """AES-128-CBC decrypt the Amtrak MapDataService payload."""
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.primitives.padding import PKCS7
    except ImportError:
        logger.warning("[trains] cryptography package not installed — cannot decrypt Amtrak data")
        return []

    # Key: MD5(p + master_segment[len(p):]), first 16 bytes → AES-128
    key_text = p_field + _MASTER_SEGMENT[len(p_field):]
    key = hashlib.md5(key_text.encode()).digest()

    raw = base64.b64decode(s_field)
    iv, ciphertext = raw[:16], raw[16:]

    cipher = Cipher(algorithms.AES(key), modes.CBC(iv))
    dec = cipher.decryptor()
    padded = dec.update(ciphertext) + dec.finalize()

    unpadder = PKCS7(128).unpadder()
    data = unpadder.update(padded) + unpadder.finalize()

    parsed = json.loads(data.decode("utf-8"))
    if isinstance(parsed, list):
        return parsed
    return parsed.get("features", [])


def _in_bbox(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return _MIN_LAT <= lat <= _MAX_LAT and _MIN_LON <= lon <= _MAX_LON


def _normalize(feature: dict) -> dict | None:
    props = feature.get("properties") or feature
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []

    if len(coords) >= 2:
        lon, lat = _safe_float(coords[0]), _safe_float(coords[1])
    else:
        lat = _safe_float(props.get("Lat") or props.get("lat"))
        lon = _safe_float(props.get("Lon") or props.get("lon"))

    if not _in_bbox(lat, lon):
        return None

    train_num = str(props.get("TrainNum") or props.get("trainNum") or "").strip()
    if not train_num:
        return None

    train_name = str(props.get("TrainName") or props.get("trainName") or "").strip()
    route_name = str(props.get("RouteName") or props.get("routeName") or "").strip()
    velocity = _safe_float(props.get("Velocity") or props.get("velocity"))
    direction = props.get("Direction") or props.get("direction")
    orig_code = str(props.get("OrigCode") or props.get("origCode") or "").strip()
    dest_code = str(props.get("DestCode") or props.get("destCode") or "").strip()
    status_code = str(props.get("EventCode") or props.get("eventCode") or "").strip()
    last_ts = str(props.get("LastValTS") or props.get("lastValTS") or "").strip()

    # Amtrak reports velocity in mph; convert to knots for the entity schema
    speed_kts = round(velocity * 0.868976, 1) if velocity is not None else None

    display_name = f"{train_name} #{train_num}" if train_name else f"Train #{train_num}"

    return {
        "entity_id": f"train:amtrak:{train_num}",
        "entity_type": "train",
        "source": "amtrak",
        "display_name": display_name,
        "lat": lat,
        "lon": lon,
        "heading": _direction_to_heading(direction),
        "speed": speed_kts,
        "altitude": None,
        "status": status_code or None,
        "identity": {
            "train_number": train_num,
            "train_name": train_name,
            "route_name": route_name,
            "origin": orig_code,
            "destination": dest_code,
            "direction": direction,
            "last_reported": last_ts,
        },
        "tags": [route_name] if route_name else None,
    }


class TrainsPoller(BasePoller):
    name = "trains"
    interval = 60  # Amtrak refreshes train positions roughly every 60 seconds
    _poll_count: int = 0

    async def poll(self):
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                resp = await client.get(
                    AMTRAK_URL,
                    headers={"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"},
                )
                resp.raise_for_status()
                payload = resp.json()
        except Exception as exc:
            logger.warning("[trains] HTTP fetch failed: %s", exc)
            return

        features: list = []

        if "S" in payload and "p" in payload:
            try:
                features = _decrypt_amtrak(payload["S"], payload["p"])
            except Exception as exc:
                logger.warning("[trains] decryption error (check _MASTER_SEGMENT constant): %s", exc)
                return
        elif "features" in payload:
            features = payload["features"]
        elif isinstance(payload, list):
            features = payload
        else:
            logger.warning("[trains] unrecognized Amtrak API response format")
            return

        published = 0
        for feat in features:
            entity = _normalize(feat)
            if entity is None:
                continue
            await publish_entity(entity, ttl=600, record_observation=True)
            published += 1

        self._poll_count += 1
        if self._poll_count <= 3 or self._poll_count % 10 == 0:
            logger.info("[trains] poll #%d: %d trains in Oregon/PNW", self._poll_count, published)
