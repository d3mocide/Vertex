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

    elif event_type == "health":
        connected = data.get("connected", False)
        logger.info("[meshcore] radio %s", "connected" if connected else "disconnected")
        await set_feed("mesh:status", {"connected": connected, "url": base_url, **data})


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
