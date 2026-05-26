"""
Meshtastic MQTT normalizer.

Handles JSON messages published by Meshtastic nodes to a local MQTT broker
when the node's MQTT uplink is configured to use JSON mode.

Configure each Meshtastic node:
  Settings → Module Config → MQTT → Server Address: <Pi LAN IP>
  JSON Enabled: on

Topic format: msh/{region}/2/json/{channel}/{node_hex_id}
Recommended subscription topic: msh/#

Message types handled:
  position  → updates mesh_node entity lat/lon/alt
  nodeinfo  → updates mesh_node entity display name and hardware info
  telemetry → updates mesh_node identity (battery, voltage, utilization)
  text      → persists to mesh_messages table (fenced from MeshCore by source_url)

MeshCore and Meshtastic MQTT can run simultaneously.  Entities from this
normalizer carry source='meshtastic'; MeshCore entities carry source='meshcore'.
The mesh panel uses source_url in mesh_messages to separate chat streams:
  MeshCore messages:    source_url starts with 'http'
  Meshtastic messages:  source_url starts with 'mqtt:'
"""

import json
import logging
import time

from bus import publish_entity
from db import write_mesh_message
from normalizers.mesh_node import snr_to_quality

logger = logging.getLogger(__name__)

_NODE_TTL    = 1_800    # 30 minutes
_CHANNEL_TTL = 86_400   # 24 hours (used for source_url namespace)


async def handle(topic: str, payload: str) -> None:
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        logger.debug("[meshtastic] non-JSON payload on %s", topic)
        return

    if not isinstance(data, dict):
        return

    msg_type = data.get("type")
    sender   = data.get("sender") or data.get("from")
    if not sender:
        return

    sender_hex = _to_hex(sender)
    entity_id  = f"mesh_node:{sender_hex}"

    # Extract channel from topic: msh/{region}/2/json/{channel}/{node_id}
    channel = _channel_from_topic(topic)

    if msg_type == "position":
        await _handle_position(data, entity_id, sender_hex)

    elif msg_type == "nodeinfo":
        await _handle_nodeinfo(data, entity_id, sender_hex)

    elif msg_type == "telemetry":
        await _handle_telemetry(data, entity_id, sender_hex)

    elif msg_type == "text":
        await _handle_text(data, entity_id, sender_hex, channel, topic)


async def _handle_position(data: dict, entity_id: str, sender_hex: str) -> None:
    payload = data.get("payload") or {}
    lat_i = payload.get("latitude_i")
    lon_i = payload.get("longitude_i")
    if lat_i is None or lon_i is None:
        return

    lat = lat_i / 1e7
    lon = lon_i / 1e7
    alt = payload.get("altitude")

    entity = {
        "entity_id":    entity_id,
        "entity_type":  "mesh_node",
        "source":       "meshtastic",
        "lat":          lat,
        "lon":          lon,
        "altitude":     float(alt) if alt is not None else None,
        "status":       "active",
        "identity": {"node_id": sender_hex},
        "tags":         ["mesh_node"],
        "signal_quality": snr_to_quality(data.get("snr") or data.get("rxSnr")),
    }
    await publish_entity(entity, ttl=_NODE_TTL, merge=True)


async def _handle_nodeinfo(data: dict, entity_id: str, sender_hex: str) -> None:
    payload = data.get("payload") or {}
    long_name  = str(payload.get("longname") or "").strip()
    short_name = str(payload.get("shortname") or "").strip()
    display    = long_name or short_name or sender_hex

    entity = {
        "entity_id":    entity_id,
        "entity_type":  "mesh_node",
        "source":       "meshtastic",
        "display_name": display,
        "lat":          None,
        "lon":          None,
        "status":       "active",
        "identity": {
            "node_id":    sender_hex,
            "long_name":  long_name or None,
            "short_name": short_name or None,
            "hw_model":   str(payload.get("hardware", "")) or None,
            "role":       payload.get("role"),
        },
        "tags": ["mesh_node"],
    }
    await publish_entity(entity, ttl=_NODE_TTL, record_observation=False, merge=True)


async def _handle_telemetry(data: dict, entity_id: str, sender_hex: str) -> None:
    payload = data.get("payload") or {}
    device  = payload.get("device_metrics") or {}

    battery  = device.get("battery_level")
    voltage  = device.get("voltage")
    chan_util = device.get("channel_utilization")
    air_util = device.get("air_util_tx")

    if battery is None and voltage is None and chan_util is None and air_util is None:
        return

    identity_update: dict = {"node_id": sender_hex}
    if battery is not None:
        identity_update["battery_level"] = battery
    if voltage is not None:
        identity_update["voltage"] = round(float(voltage), 2)
    if chan_util is not None:
        identity_update["channel_utilization"] = round(float(chan_util), 1)
    if air_util is not None:
        identity_update["air_util_tx"] = round(float(air_util), 1)

    entity = {
        "entity_id":    entity_id,
        "entity_type":  "mesh_node",
        "source":       "meshtastic",
        "status":       "active",
        "identity":     identity_update,
        "tags":         ["mesh_node"],
    }
    await publish_entity(entity, ttl=_NODE_TTL, record_observation=False, merge=True)


async def _handle_text(
    data: dict, entity_id: str, sender_hex: str, channel: str, topic: str
) -> None:
    payload = data.get("payload") or {}
    text = payload.get("text") if isinstance(payload, dict) else str(payload)
    if not text:
        return

    msg_id    = str(data.get("id") or f"msh_{int(time.time())}_{sender_hex}")
    ts        = data.get("timestamp") or data.get("rxTime") or time.time()
    to_field  = data.get("to", 0)
    # 0xFFFFFFFF is the broadcast address in Meshtastic
    is_broadcast = (to_field == 0xFFFFFFFF or to_field == 4294967295)
    msg_type_str = "channel" if is_broadcast else "direct"
    source_url   = f"mqtt:{channel}"

    try:
        await write_mesh_message({
            "id":               f"meshtastic:{msg_id}",
            "msg_type":         msg_type_str,
            "conversation_key": channel if is_broadcast else f"{sender_hex}:direct",
            "channel_name":     channel,
            "text":             str(text),
            "sender_name":      sender_hex,
            "sender_key":       sender_hex,
            "outgoing":         False,
            "acked":            False,
            "ts":               ts,
            "source_url":       source_url,
        })
    except Exception as exc:
        logger.warning("[meshtastic] message save failed: %s", exc)


def _to_hex(sender) -> str:
    if isinstance(sender, int):
        return f"!{sender:08x}"
    return str(sender)


def _channel_from_topic(topic: str) -> str:
    """Extract channel name from topic msh/{region}/2/json/{channel}/{node_id}."""
    parts = topic.split("/")
    if len(parts) >= 5:
        return parts[4]
    return "unknown"


