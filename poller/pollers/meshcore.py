"""
MeshCore poller — connects to a Remote-Terminal-for-MeshCore instance.

Contacts are fetched via REST on startup (and re-synced every 60 s) and kept
live via the RemoteTerm WebSocket event stream (contact, message, health).

Configure poller_sources with type=meshcore and the RemoteTerm base URL:
  http://192.168.1.x:8000
Credentials can be embedded: http://user:pass@192.168.1.x:8000
"""

import asyncio
import base64
import json
import logging
from urllib.parse import urlparse, urlunparse

import httpx
import websockets

from bus import get_bus, publish_entity, set_feed
from normalizers.mesh_node import normalize_remoteterm_contact
from sanitize import sanitize_payload
from .base import BasePoller

logger = logging.getLogger(__name__)

_CONTACT_POLL_INTERVAL = 60
_RETRY_DELAY = 10
_WS_PING_INTERVAL = 30


class MeshCorePoller(BasePoller):
    name = "meshcore"
    interval = _CONTACT_POLL_INTERVAL

    def __init__(self):
        self._sources: list[dict] = []

    async def poll(self):
        pass  # streaming + periodic REST — overrides run()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'meshcore' AND enabled = TRUE"
        )
        self._sources = [_parse_source(row["url"]) for row in rows]
        if self._sources:
            logger.info("[meshcore] %d RemoteTerm source(s)", len(self._sources))
        else:
            logger.warning("[meshcore] no MeshCore source configured — poller inactive")

    async def run(self):
        await self.setup()
        if not self._sources:
            return
        await asyncio.gather(*[
            asyncio.create_task(self._run_source(src))
            for src in self._sources
        ])

    async def _run_source(self, src: dict):
        await asyncio.gather(
            asyncio.create_task(self._contact_poll_loop(src)),
            asyncio.create_task(self._ws_loop(src)),
        )

    async def _contact_poll_loop(self, src: dict):
        while True:
            try:
                await _fetch_contacts(src)
                await self._heartbeat("ok")
            except Exception as exc:
                logger.error("[meshcore] contact fetch error: %s", exc)
                await self._heartbeat("error", str(exc)[:256])
            try:
                neighbors = await _fetch_neighbors(src)
                if neighbors:
                    await _upsert_mesh_links(src["base_url"], neighbors)
                    logger.debug("[meshcore] upserted %d links from %s", len(neighbors), src["base_url"])
            except Exception as exc:
                logger.debug("[meshcore] neighbor fetch skipped: %s", exc)
            await asyncio.sleep(_CONTACT_POLL_INTERVAL)

    async def _ws_loop(self, src: dict):
        ws_url = _to_ws_url(src["base_url"]) + "/api/ws"
        headers = _auth_headers(src.get("auth"))

        while True:
            try:
                async with websockets.connect(
                    ws_url,
                    extra_headers=headers,
                    ping_interval=_WS_PING_INTERVAL,
                ) as ws:
                    logger.info("[meshcore] WS connected: %s", ws_url)
                    await set_feed("mesh:status", {"connected": True, "url": src["base_url"]})
                    async for raw in ws:
                        try:
                            await _handle_ws_event(json.loads(raw), src["base_url"])
                        except Exception as exc:
                            logger.debug("[meshcore] WS event error: %s", exc)
            except Exception as exc:
                logger.error(
                    "[meshcore] WS error (%s): %s — retry in %ds", ws_url, exc, _RETRY_DELAY
                )

            await set_feed("mesh:status", {"connected": False, "url": src["base_url"]})
            await asyncio.sleep(_RETRY_DELAY)


async def _fetch_neighbors(src: dict) -> list[dict]:
    """Fetch neighbor/link-state data from RemoteTerm if the endpoint exists."""
    url = src["base_url"] + "/api/neighbors"
    auth = src.get("auth")
    httpx_auth = httpx.BasicAuth(*auth) if auth else None
    try:
        async with httpx.AsyncClient(auth=httpx_auth, timeout=10) as client:
            resp = await client.get(url)
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            payload = resp.json()
            if isinstance(payload, list):
                return payload
            return payload.get("items", payload.get("neighbors", []))
    except Exception as exc:
        logger.debug("[meshcore] neighbor fetch error: %s", exc)
        return []


async def _upsert_mesh_links(source_url: str, neighbors: list[dict]) -> None:
    from db import get_pool
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    rows = []
    for n in neighbors:
        node_a = str(n.get("node_id") or n.get("id") or "")
        node_b = str(n.get("neighbor_id") or n.get("peer_id") or "")
        if not node_a or not node_b:
            continue
        
        # Ensure IDs match the 'mesh_node:{id}' format used in the entity store
        if not node_a.startswith("mesh_node:"):
            node_a = f"mesh_node:{node_a}"
        if not node_b.startswith("mesh_node:"):
            node_b = f"mesh_node:{node_b}"
            
        rows.append((source_url, node_a, node_b, n.get("snr"), n.get("link_quality"), now))
    if not rows:
        return
    pool = get_pool()
    await pool.executemany(
        """
        INSERT INTO mesh_links (source_url, node_a, node_b, snr, link_quality, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_url, node_a, node_b)
        DO UPDATE SET snr=EXCLUDED.snr, link_quality=EXCLUDED.link_quality, last_seen=EXCLUDED.last_seen
        """,
        rows,
    )
    
    # Also publish to the bus for real-time frontend updates
    r = await get_bus()
    await r.publish("civic:updates", json.dumps(sanitize_payload({
        "type": "mesh_links",
        "data": [
            {"source_url": row[0], "node_a": row[1], "node_b": row[2], "snr": row[3], "link_quality": row[4]}
            for row in rows
        ]
    })))


async def _fetch_contacts(src: dict):
    url = src["base_url"] + "/api/contacts"
    auth = src.get("auth")
    httpx_auth = httpx.BasicAuth(*auth) if auth else None

    async with httpx.AsyncClient(auth=httpx_auth, timeout=10) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        payload = resp.json()

    contacts = (
        payload
        if isinstance(payload, list)
        else payload.get("items", payload.get("contacts", []))
    )
    count = 0
    for contact in contacts:
        entity = normalize_remoteterm_contact(contact)
        if entity:
            await publish_entity(entity)
            count += 1
    logger.debug("[meshcore] synced %d contacts from %s", count, src["base_url"])


async def _handle_ws_event(event: dict, base_url: str):
    event_type = event.get("type")
    data = event.get("data") or {}

    if event_type == "contact":
        entity = normalize_remoteterm_contact(data)
        if entity:
            await publish_entity(entity)

    elif event_type == "message":
        # Save to DB for persistence
        await _save_mesh_message(data, base_url)
        
        r = await get_bus()
        await r.publish("civic:updates", json.dumps(sanitize_payload({
            "type": "mesh_message",
            "data": {
                "id":               data.get("id"),
                "msg_type":         data.get("type"),
                "conversation_key": data.get("conversation_key"),
                "text":             data.get("text"),
                "sender_name":      data.get("sender_name"),
                "sender_key":       data.get("sender_key"),
                "outgoing":         data.get("outgoing", False),
                "acked":            data.get("acked", False),
                "timestamp":        data.get("sender_timestamp"),
                "source_url":       base_url,
            },
        })))

    elif event_type == "packet":
        # Overheard raw packet — extract signal metrics for the sender
        sender_id = data.get("from")
        snr = data.get("rx_snr")
        rssi = data.get("rx_rssi")
        logger.debug("[meshcore] raw packet from %s: snr=%s rssi=%s", sender_id, snr, rssi)
        
        if sender_id and snr is not None:
            # Ensure sender ID matches the store format
            node_b = f"mesh_node:{sender_id}" if not str(sender_id).startswith("mesh_node:") else str(sender_id)
            
            r = await get_bus()
            await r.publish("civic:updates", json.dumps(sanitize_payload({
                "type": "mesh_links",
                "data": [{
                    "source_url": base_url,
                    "node_a": "local", 
                    "node_b": node_b,
                    "snr": snr,
                    "link_quality": None
                }]
            })))

    elif event_type == "health":
        logger.info("[meshcore] raw health update: %s", data)
        # RemoteTerm uses 'radio_connected' in the health packet
        connected = data.get("radio_connected", data.get("connected", data.get("radio_ok", False)))
        
        # Extract additional stats if available
        stats = data.get("radio_stats", {})
        battery_mv = stats.get("battery_mv")
        uptime = stats.get("uptime_secs")
        
        # Map to UI expected fields
        voltage = battery_mv / 1000.0 if battery_mv else None
        # Simple Li-ion estimation: 4.2V = 100%, 3.5V = 0%
        battery_level = None
        if battery_mv:
            battery_level = min(100, max(0, int((battery_mv - 3500) / (4200 - 3500) * 100)))

        logger.info("[meshcore] radio %s (parsed from %s)", "connected" if connected else "disconnected", data)
        
        payload = {
            **data,
            "connected": connected,
            "url": base_url,
            "voltage": voltage,
            "battery_level": battery_level,
            "uptime_secs": uptime
        }
        await set_feed("mesh:status", payload)
        
        # Also publish to bus for real-time frontend updates
        r = await get_bus()
        await r.publish("civic:updates", json.dumps(sanitize_payload({
            "type": "mesh_status",
            "data": {"connected": connected, "url": base_url, **data}
        })))


async def _save_mesh_message(data: dict, source_url: str):
    from db import get_pool
    import datetime
    
    # Try to parse timestamp, fallback to now
    ts_raw = data.get("sender_timestamp")
    try:
        ts = datetime.datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if ts_raw else datetime.datetime.now(datetime.timezone.utc)
    except:
        ts = datetime.datetime.now(datetime.timezone.utc)

    pool = get_pool()
    await pool.execute(
        """
        INSERT INTO mesh_messages (id, msg_type, conversation_key, text, sender_name, sender_key, outgoing, acked, ts, source_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET acked = EXCLUDED.acked
        """,
        data.get("id"),
        data.get("type"),
        data.get("conversation_key"),
        data.get("text"),
        data.get("sender_name"),
        data.get("sender_key"),
        data.get("outgoing", False),
        data.get("acked", False),
        ts,
        source_url
    )


def _parse_source(url: str) -> dict:
    """Extract embedded credentials from URL; return clean base_url and auth tuple."""
    parsed = urlparse(url)
    auth = None
    if parsed.username:
        auth = (parsed.username, parsed.password or "")
        netloc = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
        url = urlunparse(parsed._replace(netloc=netloc))
    return {"base_url": url.rstrip("/"), "auth": auth}


def _to_ws_url(http_url: str) -> str:
    if http_url.startswith("https://"):
        return "wss://" + http_url[8:]
    return "ws://" + http_url.removeprefix("http://")


def _auth_headers(auth: tuple | None) -> dict:
    if not auth:
        return {}
    token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    return {"Authorization": f"Basic {token}"}
