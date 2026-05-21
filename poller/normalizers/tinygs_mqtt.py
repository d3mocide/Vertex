"""
TinyGS MQTT normalizer.

Handles packets published by a local TinyGS LoRa ground station to the
local Mosquitto broker.  Each received satellite packet produces:
  - A tinygs_satellite entity updated with the satellite's computed position
    at time of reception (satPos field).
  - A satellite_contact event recording SNR, RSSI, frequency, and decoded
    payload.

The ground station entity (tinygs_station) continues to be published by
the REST-based TinyGS poller when no local MQTT source is active.
"""

import json
import logging
import time

from bus import publish_entity
from db import write_event

logger = logging.getLogger(__name__)

_SATELLITE_TTL = 3600   # satellite stays on map for 1 hour after last contact
_STATION_TTL   = 600    # ground station entity TTL (matches REST poller)


async def handle(topic: str, payload: str) -> None:
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        logger.debug("[tinygs_mqtt] non-JSON payload on %s", topic)
        return

    if not isinstance(data, dict):
        return

    sat_name  = data.get("satellite") or data.get("sat") or ""
    station   = data.get("station") or data.get("stationName") or ""
    snr       = _coerce_float(data.get("SNR") or data.get("snr"))
    rssi      = _coerce_float(data.get("RSSI") or data.get("rssi"))
    frequency = _coerce_float(data.get("frequency") or data.get("freq"))
    frame     = data.get("frame")
    parsed    = data.get("parsed")
    rx_time   = data.get("time") or data.get("rxTime") or time.time()

    # Satellite position from satPos field
    sat_pos = data.get("satPos") or {}
    sat_lat = _coerce_float(sat_pos.get("lat") or sat_pos.get("latitude"))
    sat_lon = _coerce_float(sat_pos.get("lon") or sat_pos.get("longitude") or sat_pos.get("lng"))
    sat_alt = _coerce_float(sat_pos.get("alt") or sat_pos.get("altitude"))

    if sat_name and sat_lat is not None and sat_lon is not None:
        entity = {
            "entity_id":    f"tinygs:satellite:{sat_name}",
            "entity_type":  "tinygs_satellite",
            "source":       "tinygs",
            "display_name": sat_name,
            "lat":          sat_lat,
            "lon":          sat_lon,
            "altitude":     sat_alt,
            "status":       "active",
            "identity": {
                "satellite_name": sat_name,
                "frequency":      frequency,
                "mode":           data.get("mode"),
                "last_station":   station,
            },
            "tags": ["tinygs", "satellite"],
            "signal_quality": _snr_to_quality(snr),
        }
        await publish_entity(entity, ttl=_SATELLITE_TTL)

    # Always record a contact event when a packet arrives
    entity_id = f"tinygs:satellite:{sat_name}" if sat_name else "tinygs:unknown"
    try:
        await write_event(
            event_type="satellite_contact",
            entity_id=entity_id,
            severity="info",
            summary=f"Packet from {sat_name}" if sat_name else "TinyGS packet received",
            details={
                "satellite": sat_name or None,
                "station":   station or None,
                "snr":       snr,
                "rssi":      rssi,
                "frequency": frequency,
                "mode":      data.get("mode"),
                "frame":     frame,
                "parsed":    parsed,
                "rx_time":   rx_time,
            },
        )
    except Exception as exc:
        logger.warning("[tinygs_mqtt] event write failed: %s", exc)


def _coerce_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _snr_to_quality(snr: float | None) -> float | None:
    """Map SNR (dB) to a 0–1 signal quality score."""
    if snr is None:
        return None
    # Typical LoRa SNR range: -20 dB (minimum) to +10 dB (excellent)
    return max(0.0, min(1.0, (snr + 20) / 30))
