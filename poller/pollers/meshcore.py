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
import hashlib
import json
import logging
import time
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
_HEALTH_INFO_LOG_INTERVAL = 300

_last_health_info_log_ts: dict[str, float] = {}
_last_health_connected: dict[str, bool] = {}


class MeshCorePoller(BasePoller):
    name = "meshcore"
    interval = _CONTACT_POLL_INTERVAL

    def __init__(self):
        self._sources: list[dict] = []
        self._local_node_ids: dict[str, str] = {}  # base_url -> entity_id
        self._last_link_update: dict[str, float] = {}  # link_key -> timestamp
        self._channel_maps: dict[str, dict[str, str]] = {}  # base_url -> {channel_key: display_name}

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
                await self._fetch_contacts(src)
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
            try:
                self._channel_maps[src["base_url"]] = await _fetch_channels(src)
            except Exception as exc:
                logger.debug("[meshcore] channel fetch skipped: %s", exc)
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
                            await self._handle_ws_event(json.loads(raw), src["base_url"])
                        except Exception as exc:
                            logger.debug("[meshcore] WS event error: %s", exc)
            except Exception as exc:
                logger.error(
                    "[meshcore] WS error (%s): %s — retry in %ds", ws_url, exc, _RETRY_DELAY
                )

            await set_feed("mesh:status", {"connected": False, "url": src["base_url"]})
            await asyncio.sleep(_RETRY_DELAY)

    async def _fetch_contacts(self, src: dict):
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
                if contact.get("on_radio"):
                    self._local_node_ids[src["base_url"]] = entity["entity_id"]
                await publish_entity(entity)
                count += 1
        logger.debug("[meshcore] synced %d contacts from %s", count, src["base_url"])

    async def _handle_ws_event(self, event: dict, base_url: str):
        event_type = event.get("type")
        data = event.get("data") or {}

        if event_type == "contact":
            entity = normalize_remoteterm_contact(data)
            if entity:
                if data.get("on_radio"):
                    self._local_node_ids[base_url] = entity["entity_id"]
                await publish_entity(entity)

        elif event_type == "message":
            message = _normalize_mesh_message(
                data,
                base_url,
                self._channel_maps.get(base_url),
            )

            # Persist when possible, but never block real-time publication.
            try:
                await _save_mesh_message(message)
            except Exception as exc:
                logger.warning(
                    "[meshcore] failed to persist mesh message id=%s conv=%s: %s",
                    message.get("id"),
                    message.get("conversation_key"),
                    exc,
                )

            r = await get_bus()
            await r.publish("civic:updates", json.dumps(sanitize_payload({
                "type": "mesh_message",
                "data": message,
            })))

        elif event_type == "packet":
            # Overheard raw packet — extract signal metrics for the sender
            sender_id = data.get("from")
            snr = data.get("rx_snr")
            rssi = data.get("rx_rssi")
            
            if sender_id and snr is not None:
                # Ensure sender ID matches the store format
                node_b = f"mesh_node:{sender_id}" if not str(sender_id).startswith("mesh_node:") else str(sender_id)
                link_key = f"{base_url}:local->{node_b}"
                
                # Throttle real-time link updates to max once per 10s
                now = time.time()
                if now - self._last_link_update.get(link_key, 0) < 10:
                    return
                self._last_link_update[link_key] = now

                logger.debug("[meshcore] throttled link update from %s: snr=%s rssi=%s", sender_id, snr, rssi)
                
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
            logger.debug("[meshcore] raw health update: %s", data)
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

            now_mono = time.monotonic()
            prev_connected = _last_health_connected.get(base_url)
            last_info_ts = _last_health_info_log_ts.get(base_url, 0.0)
            should_log_info = (
                prev_connected is None
                or prev_connected != connected
                or (now_mono - last_info_ts) >= _HEALTH_INFO_LOG_INTERVAL
            )
            if should_log_info:
                logger.info(
                    "[meshcore] health summary: url=%s connected=%s battery_mv=%s rssi=%s snr=%s queue=%s errors=%s uptime=%s",
                    base_url,
                    connected,
                    battery_mv,
                    stats.get("last_rssi"),
                    stats.get("last_snr"),
                    stats.get("queue_len"),
                    stats.get("errors"),
                    uptime,
                )
                _last_health_info_log_ts[base_url] = now_mono
            _last_health_connected[base_url] = connected
            
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

            # If we know the local node ID, publish an entity update so the battery 
            # level is persisted and counted in the data quality metric.
            local_id = self._local_node_ids.get(base_url)
            if local_id and battery_level is not None:
                await publish_entity({
                    "entity_id": local_id,
                    "entity_type": "mesh_node",
                    "source": "meshcore",
                    "identity": {
                        "battery_level": battery_level
                    }
                }, record_observation=False)


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


async def _fetch_channels(src: dict) -> dict[str, str]:
    """Fetch channel metadata from RemoteTerm and return key->display-name map."""
    url = src["base_url"] + "/api/channels"
    auth = src.get("auth")
    httpx_auth = httpx.BasicAuth(*auth) if auth else None
    try:
        async with httpx.AsyncClient(auth=httpx_auth, timeout=10) as client:
            resp = await client.get(url)
            if resp.status_code == 404:
                return {}
            resp.raise_for_status()
            payload = resp.json()
    except Exception as exc:
        logger.debug("[meshcore] channel fetch error: %s", exc)
        return {}

    items = payload
    if isinstance(payload, dict):
        items = payload.get("items", payload.get("channels", payload))

    channel_map: dict[str, str] = {}
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            key = _coalesce(item.get("key"), item.get("id"), item.get("channel"), item.get("name"))
            name = _coalesce(item.get("name"), item.get("label"), item.get("display_name"), item.get("title"), key)
            if key is None or name is None:
                continue
            channel_map[str(key)[:128]] = str(name)[:128]
    elif isinstance(items, dict):
        for key, value in items.items():
            if isinstance(value, dict):
                name = _coalesce(value.get("name"), value.get("label"), value.get("display_name"), key)
            else:
                name = value
            if name is None:
                continue
            channel_map[str(key)[:128]] = str(name)[:128]

    return channel_map


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


def _coalesce(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
            continue
        return value
    return None


def _to_bool(value, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y", "on", "acked", "delivered"}:
            return True
        if lowered in {"0", "false", "no", "n", "off", "pending"}:
            return False
    return default


def _normalize_mesh_message(data: dict, source_url: str, channel_map: dict[str, str] | None = None) -> dict:
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    sender = data.get("sender") if isinstance(data.get("sender"), dict) else {}
    conv = data.get("conversation") if isinstance(data.get("conversation"), dict) else {}

    text = _coalesce(
        data.get("text"),
        data.get("message"),
        data.get("body"),
        data.get("content"),
        payload.get("text"),
        payload.get("message"),
        payload.get("body"),
    )
    if text is None:
        text = ""
    text = str(text)

    conversation_name = _coalesce(
        data.get("conversation_name"),
        data.get("conversationName"),
        data.get("channel_name"),
        data.get("channelName"),
        conv.get("name"),
        conv.get("label"),
        payload.get("channel_name"),
        payload.get("channelName"),
    )

    conversation_key = _coalesce(
        data.get("conversation_key"),
        data.get("conversationKey"),
        conv.get("key"),
        conv.get("id"),
        data.get("channel_id"),
        data.get("channelId"),
        data.get("channel"),
        payload.get("channel_id"),
        payload.get("channel"),
    )
    if conversation_key is None:
        conversation_key = "public"
    conversation_key = str(conversation_key)[:128]

    if conversation_name is None and channel_map:
        conversation_name = channel_map.get(conversation_key)
    if conversation_name is not None:
        conversation_name = str(conversation_name)[:128]

    msg_type = _coalesce(
        data.get("type"),
        data.get("msg_type"),
        data.get("message_type"),
        conv.get("type"),
    )
    if msg_type is None:
        msg_type = "public"
    msg_type = str(msg_type)[:32]

    sender_name = _coalesce(
        data.get("sender_name"),
        data.get("senderName"),
        data.get("from_name"),
        sender.get("name"),
        sender.get("callsign"),
        data.get("name"),
    )
    if sender_name is None:
        sender_name = "Unknown"
    sender_name = str(sender_name)[:128]

    sender_key = _coalesce(
        data.get("sender_key"),
        data.get("senderKey"),
        data.get("from"),
        sender.get("key"),
        sender.get("id"),
    )
    if sender_key is None:
        sender_key = "unknown"
    sender_key = str(sender_key)[:128]

    timestamp = _coalesce(
        data.get("sender_timestamp"),
        data.get("senderTimestamp"),
        data.get("timestamp"),
        data.get("ts"),
        data.get("sent_at"),
        data.get("created_at"),
    )
    timestamp = str(timestamp) if timestamp is not None else ""

    message_id = _coalesce(
        data.get("id"),
        data.get("message_id"),
        data.get("msg_id"),
        data.get("uuid"),
    )
    if message_id is None:
        fingerprint = f"{source_url}|{conversation_key}|{sender_key}|{timestamp}|{text}"
        message_id = hashlib.sha1(fingerprint.encode("utf-8", errors="ignore")).hexdigest()
    message_id = str(message_id)[:64]

    outgoing = _to_bool(_coalesce(data.get("outgoing"), data.get("is_outgoing"), data.get("sent_by_me")), False)
    acked = _to_bool(
        _coalesce(data.get("acked"), data.get("is_acked"), data.get("delivered"), data.get("status")),
        False,
    )

    return {
        "id": message_id,
        "msg_type": msg_type,
        "conversation_key": conversation_key,
        "channel_name": conversation_name,
        "text": text,
        "sender_name": sender_name,
        "sender_key": sender_key,
        "outgoing": outgoing,
        "acked": acked,
        "timestamp": timestamp,
        "source_url": source_url,
    }


async def _save_mesh_message(message: dict):
    from db import get_pool
    import datetime

    # Try to parse timestamp, fallback to now
    ts_raw = message.get("timestamp")
    try:
        ts = datetime.datetime.fromisoformat(ts_raw.replace("Z", "+00:00")) if ts_raw else datetime.datetime.now(datetime.timezone.utc)
    except:
        ts = datetime.datetime.now(datetime.timezone.utc)

    pool = get_pool()
    try:
        await pool.execute(
            """
            INSERT INTO mesh_messages (id, msg_type, conversation_key, channel_name, text, sender_name, sender_key, outgoing, acked, ts, source_url)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id) DO UPDATE SET
                msg_type = EXCLUDED.msg_type,
                conversation_key = EXCLUDED.conversation_key,
                channel_name = EXCLUDED.channel_name,
                text = EXCLUDED.text,
                sender_name = EXCLUDED.sender_name,
                sender_key = EXCLUDED.sender_key,
                outgoing = EXCLUDED.outgoing,
                acked = EXCLUDED.acked,
                ts = EXCLUDED.ts,
                source_url = EXCLUDED.source_url
            """,
            message.get("id"),
            message.get("msg_type"),
            message.get("conversation_key"),
            message.get("channel_name"),
            message.get("text"),
            message.get("sender_name"),
            message.get("sender_key"),
            message.get("outgoing", False),
            message.get("acked", False),
            ts,
            message.get("source_url")
        )
        return
    except Exception as exc:
        # Backward-compat: older DB volumes may not have channel_name yet.
        msg = str(exc).lower()
        if "channel_name" not in msg or ("does not exist" not in msg and "undefined" not in msg):
            raise

    await pool.execute(
        """
        INSERT INTO mesh_messages (id, msg_type, conversation_key, text, sender_name, sender_key, outgoing, acked, ts, source_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
            msg_type = EXCLUDED.msg_type,
            conversation_key = EXCLUDED.conversation_key,
            text = EXCLUDED.text,
            sender_name = EXCLUDED.sender_name,
            sender_key = EXCLUDED.sender_key,
            outgoing = EXCLUDED.outgoing,
            acked = EXCLUDED.acked,
            ts = EXCLUDED.ts,
            source_url = EXCLUDED.source_url
        """,
        message.get("id"),
        message.get("msg_type"),
        message.get("conversation_key"),
        message.get("text"),
        message.get("sender_name"),
        message.get("sender_key"),
        message.get("outgoing", False),
        message.get("acked", False),
        ts,
        message.get("source_url")
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
