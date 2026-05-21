"""
AIS MQTT normalizer.

Handles JSON messages published by AIS-catcher to the local Mosquitto broker.
AIS-catcher's MQTT output uses the same JSON schema as its WebSocket output,
so this normalizer delegates directly to the existing normalize_ais_catcher
function and feeds into the same vessel entity pipeline.

Configure AIS-catcher with:
  -N 10101 -H 192.168.1.x:1883 MQTT ON

This is an alternative transport to the WebSocket poller (poller_sources type
'ais').  Both can run simultaneously — vessel entity upserts are idempotent.
If you switch to MQTT, you can remove the 'ais' entry from poller_sources to
avoid the redundant WebSocket connection.
"""

import json
import logging

from bus import publish_entity
from normalizers.vessel import normalize_ais_catcher

logger = logging.getLogger(__name__)

_VESSEL_TTL = 600   # 10 minutes, matching the WebSocket AIS poller


async def handle(topic: str, payload: str) -> None:
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        logger.debug("[ais_mqtt] non-JSON payload on %s", topic)
        return

    if not isinstance(data, dict):
        return

    entity = normalize_ais_catcher(data)
    if entity:
        await publish_entity(entity, ttl=_VESSEL_TTL)
