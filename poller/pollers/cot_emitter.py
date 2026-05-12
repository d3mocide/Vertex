"""
TAK/CoT (Cursor-on-Target) UDP emitter.

Subscribes to Redis entity_update and annotation_update events and broadcasts:
- Entity positions as CoT datagrams to ATAK/WinTAK clients
- Vertex annotations as CoT map markers (b-m-p-s-m) to openTAK

Supports both UDP multicast (default 239.2.3.1:6969) and unicast to a
dedicated TAK server.  Enable via COT_ENABLED=true in .env.
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

    raw_uid = f"VERTEX-{entity.get('id', 'unknown')}"
    cot_type = _COT_TYPES.get(entity.get("entity_type", ""), _COT_DEFAULT)
    raw_callsign = (
        entity.get("callsign")
        or entity.get("name")
        or entity.get("mmsi")
        or raw_uid
    )
    alt_m = float(entity.get("alt_m") or entity.get("altitude_m") or 0.0)
    speed_ms = float(entity.get("speed_ms") or 0.0)
    heading = float(entity.get("heading") or 0.0)

    uid = _xe(raw_uid)
    cot_type_s = _xe(cot_type)
    callsign = _xe(raw_callsign)
    remarks = _xe(entity.get("entity_type", ""))

    now = datetime.now(timezone.utc)
    stale = now + timedelta(seconds=settings.cot_stale_seconds)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<event version="2.0" uid="{uid}" type="{cot_type_s}"'
        f' time="{_ts(now)}" start="{_ts(now)}" stale="{_ts(stale)}" how="m-g">'
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


def _make_socket() -> tuple[socket.socket, tuple[str, int]]:
    if settings.cot_takserver_host:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        addr = (settings.cot_takserver_host, settings.cot_takserver_port)
    else:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 32)
        addr = (settings.cot_multicast_addr, settings.cot_multicast_port)
    sock.setblocking(False)
    return sock, addr


class CotEmitter(BasePoller):
    """Listens on Redis pub/sub and emits CoT datagrams for entity updates and annotations."""

    name = "cot_emitter"
    interval = 0  # event-driven

    async def run(self) -> None:
        if not settings.cot_enabled:
            logger.info("[cot] CoT output disabled (COT_ENABLED not set)")
            return

        dest = (
            f"{settings.cot_takserver_host}:{settings.cot_takserver_port}"
            if settings.cot_takserver_host
            else f"multicast {settings.cot_multicast_addr}:{settings.cot_multicast_port}"
        )
        logger.info("[cot] Starting CoT emitter → %s", dest)

        r = await get_bus()
        sock, addr = _make_socket()
        loop = asyncio.get_running_loop()

        async def _send(data: bytes) -> None:
            try:
                await loop.sock_sendto(sock, data, addr)
            except Exception as exc:
                logger.debug("[cot] Send failed: %s", exc)

        try:
            async with r.pubsub() as ps:
                await ps.subscribe("civic:updates", "annotation_update")
                async for msg in ps.listen():
                    if msg["type"] != "message":
                        continue
                    try:
                        payload = json.loads(msg["data"])
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if msg["channel"] == "civic:updates":
                        if payload.get("type") != "entity_update":
                            continue
                        xml = _build_cot(payload.get("data", {}))
                    else:
                        # annotation_update channel
                        # Skip annotations that originated from TAK to avoid feedback loops.
                        if payload.get("source") == "tak":
                            continue
                        if payload.get("action") == "delete":
                            continue
                        xml = _build_annotation_cot(payload)

                    if xml:
                        await _send(xml.encode())
        finally:
            sock.close()

    async def poll(self) -> None:
        pass
