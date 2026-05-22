"""
RTL_433 MQTT normalizer.

Handles JSON messages published by rtl_433 (SDR-based RF decoder) to the
local Mosquitto broker.  Each message becomes an rf_sensor entity pinned to
the Pi's home coordinates; the sensor values are stored as observations.

RTL_433 publishes one message per decoded frame on topics like:
  rtl_433/HOST/events          — all decoded events (recommended)
  rtl_433/HOST/devices/MODEL/ID/FIELD/VALUE  — per-field topics

This normalizer handles the JSON event format only.  Configure rtl_433 with:
  rtl_433 -F "mqtt://localhost:1883,events=rtl_433/events"

Decoded fields vary by device model.  Common ones we capture:
  temperature_C, humidity, wind_speed_km_h, wind_dir_deg, rain_mm,
  pressure_hPa, battery_ok, rssi, snr, noise
"""

import json
import logging

from bus import publish_entity
from config import settings

logger = logging.getLogger(__name__)

_SENSOR_TTL = 900   # 15 minutes — sensors broadcast every few minutes


async def handle(topic: str, payload: str) -> None:
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        logger.debug("[rtl_433] non-JSON payload on %s", topic)
        return

    if not isinstance(data, dict):
        return

    model     = str(data.get("model") or "unknown")
    device_id = data.get("id") if data.get("id") is not None else data.get("channel", 0)
    channel   = data.get("channel")

    entity_id = f"rtl_433:{model}:{device_id}"

    identity: dict = {
        "model":      model,
        "device_id":  str(device_id),
        "channel":    str(channel) if channel is not None else None,
        "battery_ok": data.get("battery_ok"),
    }

    # Capture all numeric sensor fields present in this frame
    _sensor_fields = (
        "temperature_C",
        "temperature_F",
        "humidity",
        "wind_speed_km_h",
        "wind_avg_km_h",
        "wind_dir_deg",
        "rain_mm",
        "pressure_hPa",
        "uv",
        "lux",
        "moisture",
        "depth_cm",
        "power_W",
        "energy_kWh",
        "current_A",
        "voltage_V",
    )
    for field in _sensor_fields:
        if data.get(field) is not None:
            try:
                identity[field] = float(data[field])
            except (TypeError, ValueError):
                pass

    snr  = _coerce_float(data.get("snr"))
    rssi = _coerce_float(data.get("rssi"))

    # Build a human-readable display name
    display_name = _display_name(model, device_id, channel, identity)

    entity = {
        "entity_id":    entity_id,
        "entity_type":  "rf_sensor",
        "source":       "rtl_433",
        "display_name": display_name,
        "lat":          settings.region_lat,
        "lon":          settings.region_lon,
        "status":       "active",
        "identity":     identity,
        "tags":         ["rtl_433", "rf_sensor"],
        "signal_quality": _rssi_to_quality(rssi) if rssi is not None else _snr_to_quality(snr),
    }
    await publish_entity(entity, ttl=_SENSOR_TTL)


def _display_name(model: str, device_id, channel, identity: dict) -> str:
    base = model
    if channel is not None:
        base = f"{model} Ch{channel}"
    temp = identity.get("temperature_C")
    if temp is not None:
        return f"{base} ({temp:.1f}°C)"
    return base


def _coerce_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _rssi_to_quality(rssi: float) -> float:
    # Typical RSSI range for close-range 433 MHz: -120 dBm (floor) to -40 dBm (excellent)
    return max(0.0, min(1.0, (rssi + 120) / 80))


def _snr_to_quality(snr: float) -> float:
    # Typical SNR range: 0 to 30 dB
    return max(0.0, min(1.0, snr / 30))
