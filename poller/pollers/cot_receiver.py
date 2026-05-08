"""
TAK/CoT (Cursor-on-Target) TCP receiver.

Connects to an openTAK server via TCP streaming XML and ingests:
- Field operator positions (CoT type a-*) → tak_client entities in Vertex DB
- TAK map markers (CoT type b-m-p-*) → Vertex annotations (persisted + Redis pub/sub)

CoT messages arriving from TAK are tagged with their original TAK UID so the
annotation bridge can skip re-broadcasting them back to TAK (no feedback loop).

Enable via COT_RECEIVE_ENABLED=true, COT_RECEIVE_HOST=<ip> in .env.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from xml.etree import ElementTree as ET

from bus import get_bus
from config import settings
from db import get_pool
from .base import BasePoller

logger = logging.getLogger(__name__)

# Delimiter — CoT over TCP streams raw XML; split on </event> boundaries.
_EVENT_END = b"</event>"

# Map inbound CoT type prefixes to Vertex entity_type
_TAK_CLIENT_PREFIXES = ("a-f-G", "a-h-G", "a-u-G", "a-f-A", "a-f-S")


def _parse_cot(xml_bytes: bytes) -> dict[str, Any] | None:
    """Parse a CoT XML event into a normalized dict. Returns None on parse error."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        logger.debug("[cot_rx] XML parse error: %s", exc)
        return None

    uid = root.get("uid", "")
    cot_type = root.get("type", "")
    how = root.get("how", "")
    time_str = root.get("time", "")
    stale_str = root.get("stale", "")

    point = root.find("point")
    if point is None:
        return None

    try:
        lat = float(point.get("lat", "0"))
        lon = float(point.get("lon", "0"))
        hae = float(point.get("hae", "0"))
    except (ValueError, TypeError):
        return None

    detail = root.find("detail")
    callsign = uid
    remarks = ""
    if detail is not None:
        contact = detail.find("contact")
        if contact is not None:
            callsign = contact.get("callsign", uid)
        rem = detail.find("remarks")
        if rem is not None and rem.text:
            remarks = rem.text.strip()

    return {
        "uid": uid,
        "cot_type": cot_type,
        "how": how,
        "lat": lat,
        "lon": lon,
        "hae": hae,
        "callsign": callsign,
        "remarks": remarks,
        "time_str": time_str,
        "stale_str": stale_str,
    }


def _cot_type_to_entity_type(cot_type: str) -> str:
    if cot_type.startswith("a-f-A") or cot_type.startswith("a-u-A") or cot_type.startswith("a-h-A"):
        return "aircraft"
    if cot_type.startswith("a-f-S") or cot_type.startswith("a-u-S") or cot_type.startswith("a-h-S"):
        return "vessel"
    return "tak_client"


async def _upsert_tak_entity(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Write/update a TAK entity in the DB and return a Redis-publishable dict."""
    pool = get_pool()
    uid = ev["uid"]
    entity_id = f"tak-{uid}"
    entity_type = _cot_type_to_entity_type(ev["cot_type"])
    callsign = ev["callsign"]
    lat, lon = ev["lat"], ev["lon"]
    alt_m = ev["hae"]

    entity = {
        "entity_id": entity_id,
        "entity_type": entity_type,
        "source": "tak",
        "display_name": callsign,
        "identity": {"callsign": callsign, "tak_uid": uid, "cot_type": ev["cot_type"]},
        "tags": {},
        "lat": lat,
        "lon": lon,
        "alt_m": alt_m,
        "heading": 0.0,
        "speed_ms": 0.0,
    }

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO entities
                (entity_id, entity_type, source, display_name, identity, tags, first_seen, last_seen)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
            ON CONFLICT (entity_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                identity     = EXCLUDED.identity,
                last_seen    = NOW()
            """,
            entity_id, entity_type, "tak", callsign,
            json.dumps(entity["identity"]), json.dumps(entity["tags"]),
        )
        await conn.execute(
            """
            INSERT INTO observations
                (entity_id, lat, lon, alt_m, speed_ms, heading, observed_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            """,
            entity_id, lat, lon, alt_m, 0.0, 0.0,
        )

    return entity


async def _upsert_tak_annotation(ev: dict[str, Any]) -> dict[str, Any] | None:
    """Create or update a Vertex annotation from a TAK map marker."""
    pool = get_pool()
    uid = ev["uid"]
    callsign = ev["callsign"]
    lat, lon = ev["lat"], ev["lon"]

    geojson = {"type": "Point", "coordinates": [lon, lat]}

    # Check for existing annotation with this tak_uid; if found, skip (already synced).
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
        "action": "create",
        "id": ann_id,
        "annotation_type": "marker",
        "label": callsign or "TAK Marker",
        "color": "#FFB800",
        "geojson": geojson,
        "expires_at": None,
        "tak_uid": uid,
        "source": "tak",
    }


async def _process_event(ev: dict[str, Any], redis) -> None:
    cot_type = ev.get("cot_type", "")

    if cot_type.startswith("a-"):
        # Field operator / entity position update
        entity = await _upsert_tak_entity(ev)
        if entity:
            await redis.publish("entity_update", json.dumps(entity))
            await redis.set(f"entity:{entity['entity_id']}", json.dumps(entity))

    elif cot_type.startswith("b-m-p-"):
        # TAK map marker → Vertex annotation
        ann = await _upsert_tak_annotation(ev)
        if ann:
            await redis.publish("annotation_update", json.dumps(ann))

    # t-* (SA ping/presence) and other types are intentionally ignored.


class CotReceiver(BasePoller):
    """TCP CoT receiver — connects to openTAK and ingests CoT into Vertex."""

    name = "cot_receiver"
    interval = 0  # event-driven

    async def run(self) -> None:
        if not settings.cot_receive_enabled:
            logger.info("[cot_rx] CoT receive disabled (COT_RECEIVE_ENABLED not set)")
            return
        if not settings.cot_receive_host:
            logger.warning("[cot_rx] COT_RECEIVE_HOST not set — receiver disabled")
            return

        logger.info(
            "[cot_rx] Connecting to openTAK at %s:%d",
            settings.cot_receive_host,
            settings.cot_receive_port,
        )

        redis = await get_bus()
        delay = 2.0

        while True:
            try:
                reader, writer = await asyncio.open_connection(
                    settings.cot_receive_host, settings.cot_receive_port
                )
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

                        # Extract and process all complete CoT events in the buffer
                        while _EVENT_END in buf:
                            idx = buf.index(_EVENT_END) + len(_EVENT_END)
                            raw = buf[:idx].strip()
                            buf = buf[idx:]

                            # Strip any leading junk before <?xml or <event
                            start = raw.find(b"<")
                            if start > 0:
                                raw = raw[start:]

                            ev = _parse_cot(raw)
                            if ev:
                                try:
                                    await _process_event(ev, redis)
                                except Exception as exc:
                                    logger.warning("[cot_rx] process error: %s", exc)
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass

            except (ConnectionRefusedError, OSError) as exc:
                logger.warning("[cot_rx] Connection failed: %s — retry in %.0fs", exc, delay)
            except Exception as exc:
                logger.exception("[cot_rx] Unexpected error: %s", exc)

            await asyncio.sleep(delay)
            delay = min(delay * 2, 60.0)

    async def poll(self) -> None:
        pass
