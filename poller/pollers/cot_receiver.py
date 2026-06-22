"""
TAK/CoT (Cursor-on-Target) TCP receiver.

Connects to an openTAK server via TCP streaming XML and ingests:
- Field operator positions (CoT type a-*) → tak_client entities published
  via bus.publish_entity() so they appear on the Vertex map in real time
- TAK map markers (CoT type b-m-p-*) → Vertex annotations persisted to DB
  and broadcast on the annotation_update Redis channel

CoT messages arriving from TAK are tagged with their original TAK UID so the
annotation bridge can skip re-broadcasting them back to TAK (no feedback loop).

Enable via COT_RECEIVE_ENABLED=true, COT_TAKSERVER_HOST=<ip> in .env.
"""

import asyncio
import json
import logging
from typing import Any
from xml.etree import ElementTree as ET

from bus import get_bus, publish_entity
from config import settings
from db import get_pool
from security import validate_safe_host
from .base import BasePoller

logger = logging.getLogger(__name__)

# Delimiter — CoT over TCP streams raw XML; split on </event> boundaries.
_EVENT_END = b"</event>"


def _parse_cot(xml_bytes: bytes) -> dict[str, Any] | None:
    """Parse a CoT XML event into a normalized dict. Returns None on parse error."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        logger.debug("[cot_rx] XML parse error: %s", exc)
        return None

    uid      = root.get("uid", "")
    cot_type = root.get("type", "")

    # Skip CoT that Vertex itself emitted and OTS echoed back.
    if uid.startswith("VERTEX-"):
        return None

    point = root.find("point")
    if point is None:
        return None

    try:
        lat = float(point.get("lat", "0"))
        lon = float(point.get("lon", "0"))
        hae = float(point.get("hae", "0"))
    except (ValueError, TypeError):
        return None

    detail   = root.find("detail")
    callsign = uid
    if detail is not None:
        contact = detail.find("contact")
        if contact is not None:
            callsign = contact.get("callsign", uid)

    if lat == 0.0 and lon == 0.0:
        logger.debug("[cot_rx] dropping null-island event: %s", uid)
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        logger.debug("[cot_rx] dropping out-of-range coordinates: %s (%.4f, %.4f)", uid, lat, lon)
        return None

    return {
        "uid":      uid,
        "cot_type": cot_type,
        "lat":      lat,
        "lon":      lon,
        "hae":      hae,
        "callsign": callsign,
    }


def _cot_type_to_entity_type(cot_type: str) -> str:
    if cot_type.startswith(("a-f-A", "a-u-A", "a-h-A")):
        return "aircraft"
    if cot_type.startswith(("a-f-S", "a-u-S", "a-h-S")):
        return "vessel"
    return "tak_client"


def _build_tak_entity(ev: dict[str, Any]) -> dict[str, Any]:
    """Build a Vertex-normalised entity dict from a parsed CoT position event."""
    uid         = ev["uid"]
    entity_type = _cot_type_to_entity_type(ev["cot_type"])
    callsign    = ev["callsign"]

    return {
        "entity_id":    f"tak-{uid}",
        "entity_type":  entity_type,
        "source":       "tak",
        "display_name": callsign,
        "identity":     {"callsign": callsign, "tak_uid": uid, "cot_type": ev["cot_type"]},
        "tags":         [],
        "lat":          ev["lat"],
        "lon":          ev["lon"],
        # Use standard field names so write_entity_observation and the frontend
        # both receive the correct keys.
        "altitude":     ev["hae"],
        "heading":      0.0,
        "speed":        0.0,
        "vertical_rate": None,
        "status":       None,
    }


async def _upsert_tak_annotation(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Persist a TAK map marker as a Vertex annotation. Returns None if already synced."""
    pool     = get_pool()
    uid      = ev["uid"]
    callsign = ev["callsign"]
    lat, lon = ev["lat"], ev["lon"]
    geojson  = {"type": "Point", "coordinates": [lon, lat]}

    async with pool.acquire() as conn:
        existing = await conn.fetchval(
            "SELECT id FROM annotations WHERE tak_uid = $1", uid
        )
        if existing:
            return None

        ann_id = await conn.fetchval(
            """
            INSERT INTO annotations
                (annotation_type, label, color, geojson, created_by, tak_uid)
            VALUES ('marker', $1, '#FFB800', $2::jsonb, 'tak', $3)
            RETURNING id
            """,
            callsign or "TAK Marker",
            json.dumps(geojson),
            uid,
        )

    return {
        "action":          "create",
        "id":              ann_id,
        "annotation_type": "marker",
        "label":           callsign or "TAK Marker",
        "color":           "#FFB800",
        "geojson":         geojson,
        "expires_at":      None,
        "tak_uid":         uid,
        "source":          "tak",
    }


async def _process_event(ev: dict[str, Any]) -> None:
    cot_type = ev.get("cot_type", "")

    if cot_type.startswith("a-"):
        # Publish via bus so the entity lands on civic:updates → WebSocket → frontend
        # and gets persisted to DB via write_entity_observation.
        entity = _build_tak_entity(ev)
        await publish_entity(entity, ttl=600)

    elif cot_type.startswith("b-m-p-"):
        ann = await _upsert_tak_annotation(ev)
        if ann:
            r = await get_bus()
            await r.publish("annotation_update", json.dumps(ann))

    # t-* (SA ping/presence) and other types are intentionally ignored.


class CotReceiver(BasePoller):
    """TCP CoT receiver — connects to openTAK and ingests CoT into Vertex."""

    name     = "cot_receiver"
    interval = 0  # event-driven

    async def run(self) -> None:
        if not settings.cot_receive_enabled:
            logger.info("[cot_rx] CoT receive disabled (COT_RECEIVE_ENABLED not set)")
            return
        if not settings.cot_takserver_host:
            logger.warning("[cot_rx] COT_TAKSERVER_HOST not set — receiver disabled")
            return

        logger.info(
            "[cot_rx] Connecting to openTAK at %s:%d",
            settings.cot_takserver_host,
            settings.cot_takserver_port,
        )

        delay = 2.0
        _consecutive_failures = 0

        while True:
            try:
                await validate_safe_host(settings.cot_takserver_host)
                reader, writer = await asyncio.open_connection(
                    settings.cot_takserver_host, settings.cot_takserver_port
                )
                _consecutive_failures = 0
                delay = 2.0
                logger.info("[cot_rx] Connected to openTAK")
                buf = b""

                try:
                    while True:
                        chunk = await reader.read(4096)
                        if not chunk:
                            logger.warning("[cot_rx] openTAK closed connection")
                            break
                        buf += chunk

                        if len(buf) > 1_000_000:
                            logger.warning("[cot_rx] receive buffer overflow, resetting connection")
                            break

                        while _EVENT_END in buf:
                            idx = buf.index(_EVENT_END) + len(_EVENT_END)
                            raw = buf[:idx].strip()
                            buf = buf[idx:]

                            start = raw.find(b"<")
                            if start > 0:
                                raw = raw[start:]

                            ev = _parse_cot(raw)
                            if ev:
                                try:
                                    await _process_event(ev)
                                except Exception as exc:
                                    logger.warning("[cot_rx] process error: %s", exc)
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass

            except (ConnectionRefusedError, OSError) as exc:
                _consecutive_failures += 1
                if _consecutive_failures >= 5:
                    logger.error(
                        "[cot_rx] Connection failed (%d consecutive): %s — retry in %.0fs",
                        _consecutive_failures, exc, delay,
                    )
                else:
                    logger.warning("[cot_rx] Connection failed: %s — retry in %.0fs", exc, delay)
            except Exception as exc:
                _consecutive_failures += 1
                if _consecutive_failures >= 5:
                    logger.error(
                        "[cot_rx] Unexpected error (%d consecutive): %s — retry in %.0fs",
                        _consecutive_failures, exc, delay,
                    )
                else:
                    logger.exception("[cot_rx] Unexpected error: %s", exc)

            await asyncio.sleep(delay)
            delay = min(delay * 2, 60.0)

    async def poll(self) -> None:
        pass
