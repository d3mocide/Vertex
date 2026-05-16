import logging

import httpx

from bus import publish_entity
from .base import BasePoller

logger = logging.getLogger(__name__)

# Amtraker V3 — public aggregator for Amtrak (and Via Rail) train positions.
# No API key required. Returns plain JSON; no AES decryption needed.
AMTRAK_URL = "https://api-v3.amtraker.com/v3/trains"

# Oregon + SW Washington — broad enough to catch trains en route through the state.
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


def _in_bbox(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return _MIN_LAT <= lat <= _MAX_LAT and _MIN_LON <= lon <= _MAX_LON


def _normalize(train: dict) -> dict | None:
    """Normalize a single train object from the Amtraker V3 API response."""
    lat = _safe_float(train.get("lat"))
    lon = _safe_float(train.get("lon"))

    if not _in_bbox(lat, lon):
        return None

    train_num  = str(train.get("trainNum") or train.get("trainNumRaw") or "").strip()
    if not train_num:
        return None

    route_name = str(train.get("routeName") or "").strip()
    velocity   = _safe_float(train.get("velocity"))
    direction  = train.get("heading")
    orig_code  = str(train.get("origCode") or "").strip()
    dest_code  = str(train.get("destCode") or "").strip()
    orig_name  = str(train.get("origName") or "").strip()
    dest_name  = str(train.get("destName") or "").strip()
    status     = str(train.get("eventCode") or "").strip()
    last_ts    = str(train.get("lastValTS") or "").strip()

    # velocity from Amtraker V3 is in mph; convert to knots for consistency
    speed_kts = round(velocity * 0.868976, 1) if velocity is not None else None
    display_name = f"{route_name} #{train_num}" if route_name else f"Train #{train_num}"

    return {
        "entity_id":    f"train:amtrak:{train_num}",
        "entity_type":  "train",
        "source":       "amtrak",
        "display_name": display_name,
        "lat":          lat,
        "lon":          lon,
        "heading":      _direction_to_heading(direction),
        "speed":        speed_kts,
        "altitude":     None,
        "status":       status or None,
        "identity": {
            "train_number":  train_num,
            "train_name":    route_name,
            "route_name":    route_name,
            "origin":        orig_code,
            "destination":   dest_code,
            "origin_name":   orig_name,
            "dest_name":     dest_name,
            "direction":     direction,
            "last_reported": last_ts,
        },
        "tags": [route_name] if route_name else None,
    }


class AmtrakPoller(BasePoller):
    name = "amtrak"
    interval = 60  # Amtraker V3 updates roughly every 60 seconds

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
            logger.warning("[amtrak] fetch failed: %s", exc)
            return

        # Amtraker V3 returns a dict keyed by train number; each value is a list
        # of train objects (multiple active consists can share a number).
        if not isinstance(payload, dict):
            logger.warning("[amtrak] unexpected response type: %s", type(payload).__name__)
            return

        published = 0
        for _train_key, trains in payload.items():
            if not isinstance(trains, list):
                continue
            for train in trains:
                entity = _normalize(train)
                if entity is None:
                    continue
                await publish_entity(entity, ttl=600, record_observation=True)
                published += 1

        self._poll_count += 1
        if self._poll_count <= 3 or self._poll_count % 10 == 0:
            logger.info(
                "[amtrak] poll #%d: %d trains in Oregon/PNW", self._poll_count, published
            )
