"""
MeshCore → WebSocket bridge for Vertex poller.

Modes (set via MESHCORE_MODE env var):
  serial   — read directly from a MeshCore gateway node on a USB serial device
  network  — connect to an existing MeshCore companion hub via TCP

Exposes a WebSocket server on port 7001. The Vertex poller subscribes
to this socket and receives canonical node-update JSON messages.
"""

import asyncio
import json
import logging
import os
import struct
from datetime import datetime, timezone
from typing import Optional

import websockets

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [meshcore-bridge] %(message)s",
)
logger = logging.getLogger(__name__)

MODE            = os.environ.get("MESHCORE_MODE", "serial")
SERIAL_DEVICE   = os.environ.get("MESHCORE_SERIAL_DEVICE", "/dev/meshcore")
SERIAL_BAUD     = int(os.environ.get("MESHCORE_BAUD", "115200"))
NETWORK_HOST    = os.environ.get("MESHCORE_HOST", "")
NETWORK_PORT    = int(os.environ.get("MESHCORE_PORT", "5000"))
WS_PORT         = int(os.environ.get("BRIDGE_WS_PORT", "7001"))

_subscribers: set = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_entity(node: dict) -> dict:
    node_id = node.get("id", "unknown")
    return {
        "entity_id":    f"mesh_node:{node_id}",
        "entity_type":  "mesh_node",
        "source":       "meshcore",
        "display_name": node.get("name") or node.get("short_name") or node_id,
        "identity": {
            "node_id":    node_id,
            "short_name": node.get("short_name", ""),
            "hw_model":   node.get("hw_model", ""),
        },
        "lat":      node.get("lat"),
        "lon":      node.get("lon"),
        "altitude": node.get("altitude"),
        "status":   _build_status(node),
        "last_seen": node.get("timestamp") or _now(),
        "tags":     ["mesh_node"],
    }


def _build_status(node: dict) -> str:
    parts = []
    if (bat := node.get("battery_pct")) is not None:
        parts.append(f"bat:{bat}%")
    if (snr := node.get("snr")) is not None:
        parts.append(f"snr:{snr:.1f}")
    if (rssi := node.get("rssi")) is not None:
        parts.append(f"rssi:{rssi}")
    return " ".join(parts)


async def _broadcast(entity: dict):
    if not _subscribers:
        return
    msg = json.dumps({"type": "node_update", "data": entity})
    dead = set()
    for ws in list(_subscribers):
        try:
            await ws.send(msg)
        except Exception:
            dead.add(ws)
    _subscribers -= dead


# ---------------------------------------------------------------------------
# Serial mode — MeshCore frame reader
# Frame format (little-endian):
#   [0xAA] [type:1] [len:2] [payload:len] [crc:1]
# Packet types we handle:
#   0x01 = NODEINFO  payload: id[4] name[16] short_name[4] hw_model[2]
#   0x02 = POSITION  payload: id[4] lat_i[4] lon_i[4] alt[2] battery[1] snr_i[1]
# Adjust to match your firmware version if the offsets differ.
# ---------------------------------------------------------------------------

async def _run_serial():
    import serial_asyncio  # pyserial-asyncio

    logger.info("Serial mode — device=%s baud=%d", SERIAL_DEVICE, SERIAL_BAUD)
    nodes: dict[str, dict] = {}

    while True:
        try:
            reader, _ = await serial_asyncio.open_serial_connection(
                url=SERIAL_DEVICE, baudrate=SERIAL_BAUD
            )
            logger.info("Serial connected")
            buf = bytearray()

            while True:
                chunk = await reader.read(256)
                buf.extend(chunk)

                while len(buf) >= 4:
                    if buf[0] != 0xAA:
                        buf.pop(0)
                        continue
                    pkt_type = buf[1]
                    pkt_len  = struct.unpack_from("<H", buf, 2)[0]
                    if len(buf) < 4 + pkt_len + 1:
                        break
                    payload = bytes(buf[4 : 4 + pkt_len])
                    buf = buf[4 + pkt_len + 1 :]

                    entity = _parse_serial_packet(pkt_type, payload, nodes)
                    if entity:
                        await _broadcast(entity)

        except Exception as exc:
            logger.error("Serial error: %s — retry in 5s", exc)
            await asyncio.sleep(5)


def _parse_serial_packet(pkt_type: int, payload: bytes, nodes: dict) -> Optional[dict]:
    try:
        if pkt_type == 0x01 and len(payload) >= 22:  # NODEINFO
            node_id    = payload[:4].hex()
            name       = payload[4:20].rstrip(b"\x00").decode("utf-8", errors="replace")
            short_name = payload[20:24].rstrip(b"\x00").decode("utf-8", errors="replace")
            nodes.setdefault(node_id, {})["id"]         = node_id
            nodes[node_id]["name"]       = name
            nodes[node_id]["short_name"] = short_name
            return _build_entity(nodes[node_id])

        if pkt_type == 0x02 and len(payload) >= 14:  # POSITION
            node_id     = payload[:4].hex()
            lat_i, lon_i = struct.unpack_from("<ii", payload, 4)
            alt          = struct.unpack_from("<h", payload, 12)[0]
            battery      = payload[14] if len(payload) > 14 else None
            snr_raw      = struct.unpack_from("<b", payload, 15)[0] if len(payload) > 15 else None

            nodes.setdefault(node_id, {})["id"]          = node_id
            nodes[node_id]["lat"]         = lat_i / 1e6
            nodes[node_id]["lon"]         = lon_i / 1e6
            nodes[node_id]["altitude"]    = float(alt)
            nodes[node_id]["battery_pct"] = battery
            nodes[node_id]["snr"]         = snr_raw / 4.0 if snr_raw is not None else None
            nodes[node_id]["timestamp"]   = _now()
            return _build_entity(nodes[node_id])

    except Exception as exc:
        logger.debug("Packet parse error type=0x%02x: %s", pkt_type, exc)
    return None


# ---------------------------------------------------------------------------
# Network mode — connect to existing MeshCore hub TCP API (JSON lines)
# Expected message format from hub:
#   {"type":"POSITION","id":"a1b2c3","name":"KD7XYZ","lat":45.384,"lon":-122.763,
#    "altitude":55,"battery_pct":85,"snr":5.5,"rssi":-89,"timestamp":"..."}
#   {"type":"NODEINFO","id":"a1b2c3","name":"KD7XYZ","short_name":"7XYZ","hw_model":"TBEAM"}
# ---------------------------------------------------------------------------

async def _run_network():
    logger.info("Network mode — host=%s port=%d", NETWORK_HOST, NETWORK_PORT)
    while True:
        try:
            reader, _ = await asyncio.open_connection(NETWORK_HOST, NETWORK_PORT)
            logger.info("Connected to MeshCore hub at %s:%d", NETWORK_HOST, NETWORK_PORT)
            async for line in reader:
                try:
                    msg = json.loads(line.decode().strip())
                    node_id = msg.get("id", "unknown")
                    node = {
                        "id":          node_id,
                        "name":        msg.get("name", ""),
                        "short_name":  msg.get("short_name", ""),
                        "hw_model":    msg.get("hw_model", ""),
                        "lat":         msg.get("lat"),
                        "lon":         msg.get("lon"),
                        "altitude":    msg.get("altitude"),
                        "battery_pct": msg.get("battery_pct"),
                        "snr":         msg.get("snr"),
                        "rssi":        msg.get("rssi"),
                        "timestamp":   msg.get("timestamp") or _now(),
                    }
                    if node.get("lat") is not None:
                        await _broadcast(_build_entity(node))
                except json.JSONDecodeError:
                    pass
        except Exception as exc:
            logger.error("Network error: %s — retry in 5s", exc)
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# WebSocket server — poller subscribes here
# ---------------------------------------------------------------------------

async def _ws_handler(websocket):
    _subscribers.add(websocket)
    logger.info("Poller subscribed (total=%d)", len(_subscribers))
    try:
        await websocket.wait_closed()
    finally:
        _subscribers.discard(websocket)
        logger.info("Poller disconnected (total=%d)", len(_subscribers))


async def main():
    reader_task = asyncio.create_task(
        _run_serial() if MODE == "serial" else _run_network()
    )
    async with websockets.serve(_ws_handler, "0.0.0.0", WS_PORT):
        logger.info("WebSocket bridge listening on :%d (mode=%s)", WS_PORT, MODE)
        await reader_task


if __name__ == "__main__":
    asyncio.run(main())
