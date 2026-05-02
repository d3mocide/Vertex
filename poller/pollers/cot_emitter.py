"""
TAK/CoT (Cursor-on-Target) UDP emitter.

Subscribes to Redis entity_update events and broadcasts each entity's
position as a CoT XML datagram — compatible with ATAK, WinTAK, and any
CoT-aware tool.  Supports both UDP multicast (default 239.2.3.1:6969)
and unicast to a dedicated TAK server.

Enable via COT_ENABLED=true in .env.
"""

import asyncio
import json
import logging
import socket
import struct
from datetime import datetime, timedelta, timezone
from typing import Any

from bus import get_bus
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

# Map Vertex entity_type → CoT type atom
_COT_TYPES: dict[str, str] = {
    "aircraft":     "a-f-A",
    "vessel":       "a-f-S-X-M",
    "mesh_node":    "a-f-G-U-C",
    "aprs":         "a-f-G-E-S",
    "fire_incident": "a-h-G",
}
_COT_DEFAULT = "a-u-G"


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.00Z")


def _build_cot(entity: dict[str, Any]) -> str | None:
    lat = entity.get("lat")
    lon = entity.get("lon")
    if lat is None or lon is None:
        return None

    uid = f"VERTEX-{entity.get('id', 'unknown')}"
    cot_type = _COT_TYPES.get(entity.get("entity_type", ""), _COT_DEFAULT)
    callsign = (
        entity.get("callsign")
        or entity.get("name")
        or entity.get("mmsi")
        or uid
    )
    alt_m = entity.get("alt_m") or entity.get("altitude_m") or 0.0
    speed_ms = (entity.get("speed_ms") or 0.0)
    heading = entity.get("heading") or 0.0
    remarks = entity.get("entity_type", "")

    now = datetime.now(timezone.utc)
    stale = now + timedelta(seconds=settings.cot_stale_seconds)

    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<event version="2.0" uid="{uid}" type="{cot_type}"'
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
    """Listens on Redis pub/sub and emits CoT datagrams for every entity update."""

    name = "cot_emitter"
    interval = 0  # not used — event-driven

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
                await ps.subscribe("entity_update")
                async for msg in ps.listen():
                    if msg["type"] != "message":
                        continue
                    try:
                        entity = json.loads(msg["data"])
                    except (json.JSONDecodeError, TypeError):
                        continue
                    xml = _build_cot(entity)
                    if xml:
                        await _send(xml.encode())
        finally:
            sock.close()

    # BasePoller requires poll() — not used for this event-driven poller
    async def poll(self) -> None:
        pass
