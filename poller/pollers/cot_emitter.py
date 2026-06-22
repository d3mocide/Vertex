"""
TAK/CoT (Cursor-on-Target) emitter.

Subscribes to Redis entity_update and annotation_update events and broadcasts:
- Entity positions as CoT events to ATAK/WinTAK clients
- Vertex annotations as CoT map markers (b-m-p-s-m) to openTAK

When COT_TAKSERVER_HOST is set, connects via TCP (required by OpenTAK Server
and most modern TAK servers). Falls back to UDP multicast (239.2.3.1:6969)
when no server host is configured.

Enable via COT_ENABLED=true in .env.
"""

import asyncio
import json
import logging
import socket
import xml.sax.saxutils
from datetime import datetime, timedelta, timezone
from typing import Any

from bus import get_bus
from config import settings
from security import validate_safe_host
from .base import BasePoller

logger = logging.getLogger(__name__)

# Map Vertex entity_type → CoT type atom
_COT_TYPES: dict[str, str] = {
    "aircraft":      "a-f-A",
    "vessel":        "a-f-S-X-M",
    "mesh_node":     "a-f-G-U-C",
    "aprs":          "a-f-G-E-S",
    "fire_incident": "a-h-G",
    "tak_client":    "a-f-G-U-C-I",  # friendly ground unit / individual
}
_COT_DEFAULT = "a-u-G"

# Map annotation color hex → CoT color name (ATAK palette)
_COLOR_MAP: dict[str, str] = {
    "#ef4444": "Red",
    "#f97316": "Orange",
    "#f59e0b": "Yellow",
    "#22c55e": "Green",
    "#06b6d4": "Cyan",
    "#a855f7": "Purple",
    "#ec4899": "Magenta",
}


def _xe(val: object) -> str:
    """Escape a value for safe interpolation into XML text or attribute values."""
    return xml.sax.saxutils.escape(str(val), entities={'"': "&quot;", "'": "&apos;"})


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.00Z")


def _build_cot(entity: dict[str, Any]) -> str | None:
    lat = entity.get("lat")
    lon = entity.get("lon")
    if lat is None or lon is None:
        return None

    # Fix UID collision bug (prefer entity_id or id)
    entity_id = entity.get("entity_id") or entity.get("id") or "unknown"
    raw_uid = f"VERTEX-{entity_id}"

    cot_type = _COT_TYPES.get(entity.get("entity_type", ""), _COT_DEFAULT)
    raw_callsign = (
        entity.get("callsign")
        or entity.get("name")
        or entity.get("mmsi")
        or raw_uid
    )

    # Fix Altitude HAE scaling (convert feet to meters for aircraft)
    alt_m = 0.0
    if entity.get("entity_type") == "aircraft":
        alt_ft = entity.get("altitude")
        if alt_ft is not None:
            alt_m = float(alt_ft) * 0.3048
    else:
        alt_val = entity.get("altitude_m") or entity.get("alt_m") or entity.get("altitude") or 0.0
        alt_m = float(alt_val)

    # Fix Speed scaling (convert knots to m/s for aircraft and vessels)
    speed_ms = 0.0
    if entity.get("entity_type") in ("aircraft", "vessel"):
        speed_kts = entity.get("speed")
        if speed_kts is not None:
            speed_ms = float(speed_kts) * 0.514444
    else:
        speed_val = entity.get("speed_ms") or entity.get("speed") or 0.0
        speed_ms = float(speed_val)

    heading = float(entity.get("heading") or 0.0)

    uid = _xe(raw_uid)
    cot_type_s = _xe(cot_type)
    callsign = _xe(raw_callsign)
    remarks = _xe(entity.get("entity_type", ""))

    now = datetime.now(timezone.utc)

    # Fix timestamp jitter / rubberbanding (use last_seen sensor time if available)
    last_seen_str = entity.get("last_seen")
    if last_seen_str:
        try:
            event_time = datetime.fromisoformat(last_seen_str.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            event_time = now
    else:
        event_time = now

    stale = now + timedelta(seconds=settings.cot_stale_seconds)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<event version="2.0" uid="{uid}" type="{cot_type_s}"'
        f' time="{_ts(event_time)}" start="{_ts(now)}" stale="{_ts(stale)}" how="m-g">'
        f'<point lat="{lat:.6f}" lon="{lon:.6f}" hae="{alt_m:.1f}"'
        f' ce="9999999.0" le="9999999.0"/>'
        "<detail>"
        f'<contact callsign="{callsign}"/>'
        f'<track speed="{speed_ms:.2f}" course="{heading:.1f}"/>'
        f'<uid Droid="{callsign}"/>'
        f"<remarks>{remarks}</remarks>"
        "</detail>"
        "</event>"
    )


def _build_annotation_cot(ann: dict[str, Any]) -> str | None:
    """Convert a Vertex annotation to a CoT map marker for openTAK."""
    geojson = ann.get("geojson", {})
    ann_type = ann.get("annotation_type", "marker")
    label = ann.get("label") or "Vertex Marker"
    color_hex = ann.get("color", "#FFB800").lower()
    color_name = _COLOR_MAP.get(color_hex, "Yellow")
    ann_id = ann.get("id", "unknown")
    raw_uid = ann.get("tak_uid") or f"VERTEX-ANN-{ann_id}"

    # Extract representative lat/lon
    coords = geojson.get("coordinates")
    lat: float | None = None
    lon: float | None = None

    if ann_type == "marker" and isinstance(coords, list) and len(coords) == 2:
        lon, lat = coords[0], coords[1]
    elif ann_type == "line" and isinstance(coords, list) and len(coords) >= 1:
        lon, lat = coords[0][0], coords[0][1]
    elif ann_type == "polygon" and isinstance(coords, list) and len(coords) >= 1:
        ring = coords[0]
        if ring:
            lons = [p[0] for p in ring]
            lats = [p[1] for p in ring]
            lon = sum(lons) / len(lons)
            lat = sum(lats) / len(lats)

    if lat is None or lon is None:
        return None

    uid = _xe(raw_uid)
    label_s = _xe(label)
    ann_type_s = _xe(ann_type)
    color_name_s = _xe(color_name)

    now = datetime.now(timezone.utc)
    stale_dt = ann.get("expires_at")
    if stale_dt:
        try:
            stale = datetime.fromisoformat(stale_dt.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            stale = now + timedelta(hours=24)
    else:
        stale = now + timedelta(days=365)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<event version="2.0" uid="{uid}" type="b-m-p-s-m"'
        f' time="{_ts(now)}" start="{_ts(now)}" stale="{_ts(stale)}" how="h-g-i-g-o">'
        f'<point lat="{lat:.6f}" lon="{lon:.6f}" hae="0.0" ce="9999999.0" le="9999999.0"/>'
        "<detail>"
        f'<contact callsign="{label_s}"/>'
        f'<uid Droid="{label_s}"/>'
        f'<color argb="-1"/>'
        f'<usericon iconsetpath="COT_MAPPING_2525B/a-f-G/a-f-G.png"/>'
        f'<remarks>Vertex {ann_type_s} — color:{color_name_s}</remarks>'
        "</detail>"
        "</event>"
    )


def _msg_to_cot(msg: dict, allowed: frozenset[str] | None = None) -> str | None:
    """Convert a Redis pub/sub message to a CoT XML string, or None to skip.

    allowed: frozenset of entity_type strings to emit; None means emit all.
    """
    if msg["type"] != "message":
        return None
    try:
        payload = json.loads(msg["data"])
    except (json.JSONDecodeError, TypeError):
        return None

    if msg["channel"] == "civic:updates":
        if payload.get("type") != "entity_update":
            return None
        entity = payload.get("data", {})
        if allowed is not None and entity.get("entity_type") not in allowed:
            return None
        return _build_cot(entity)
    else:
        # annotation_update — skip TAK-sourced annotations to avoid feedback loops
        if payload.get("source") == "tak":
            return None
        if payload.get("action") == "delete":
            return None
        return _build_annotation_cot(payload)


class CotEmitter(BasePoller):
    """Listens on Redis pub/sub and emits CoT events for entity updates and annotations.

    Uses TCP when COT_TAKSERVER_HOST is set (required by OpenTAK Server and most
    modern TAK servers). Falls back to UDP multicast for LAN-only deployments.
    """

    name = "cot_emitter"
    interval = 0  # event-driven

    async def run(self) -> None:
        if not settings.cot_enabled:
            logger.info("[cot] CoT output disabled (COT_ENABLED not set)")
            return

        raw = {t.strip() for t in settings.cot_entity_types.split(",") if t.strip()}
        allowed: frozenset[str] | None = frozenset(raw) if raw else None
        if allowed:
            logger.info("[cot] Filtering entity types: %s", ", ".join(sorted(allowed)))
        else:
            logger.info("[cot] Emitting all entity types")

        if settings.cot_takserver_host:
            await self._run_tcp(settings.cot_takserver_host, settings.cot_takserver_port, allowed)
        else:
            await self._run_udp(allowed)

    async def _run_tcp(self, host: str, port: int, allowed: frozenset[str] | None) -> None:
        logger.info("[cot] Starting CoT emitter (TCP) → %s:%d", host, port)
        delay = 2.0
        failures = 0

        while True:
            try:
                await validate_safe_host(host)
                reader, writer = await asyncio.open_connection(host, port)
                failures = 0
                delay = 2.0
                logger.info("[cot] TCP connected to TAK server %s:%d", host, port)

                r = await get_bus()
                try:
                    async with r.pubsub() as ps:
                        await ps.subscribe("civic:updates", "annotation_update")
                        async for msg in ps.listen():
                            xml = _msg_to_cot(msg, allowed)
                            if xml:
                                try:
                                    writer.write(xml.encode())
                                    await writer.drain()
                                except (ConnectionResetError, BrokenPipeError, OSError) as exc:
                                    logger.warning("[cot] TCP send failed: %s — reconnecting", exc)
                                    break
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass

            except (ConnectionRefusedError, OSError) as exc:
                failures += 1
                logger.warning(
                    "[cot] TCP connect failed (%d): %s — retry in %.0fs", failures, exc, delay
                )
            except Exception as exc:
                failures += 1
                logger.exception("[cot] Unexpected error (%d) — retry in %.0fs", failures, delay)

            await asyncio.sleep(delay)
            delay = min(delay * 2, 60.0)

    async def _run_udp(self, allowed: frozenset[str] | None) -> None:
        addr = (settings.cot_multicast_addr, settings.cot_multicast_port)
        logger.info("[cot] Starting CoT emitter (UDP multicast) → %s:%d", *addr)

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 32)
        sock.setblocking(False)
        loop = asyncio.get_running_loop()

        async def _send(data: bytes) -> None:
            try:
                await loop.sock_sendto(sock, data, addr)
            except Exception as exc:
                logger.debug("[cot] UDP send failed: %s", exc)

        r = await get_bus()
        try:
            async with r.pubsub() as ps:
                await ps.subscribe("civic:updates", "annotation_update")
                async for msg in ps.listen():
                    xml = _msg_to_cot(msg, allowed)
                    if xml:
                        await _send(xml.encode())
        finally:
            sock.close()

    async def poll(self) -> None:
        pass
