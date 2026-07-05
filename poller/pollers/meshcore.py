"""
MeshCore poller — connects to a pyMC-Repeater instance.

Polls the pyMC-Repeater REST API for node adverts, packet SNR metrics, and
system health.  Optionally streams real-time events from the companion SSE
endpoint when a companion identity is configured on the repeater.

Configure poller_sources with type=meshcore and the repeater base URL:
  http://192.168.1.x:8000
Embed an API key as the URL username to authenticate:
  http://MY_API_KEY@192.168.1.x:8000

See: https://github.com/pyMC-dev/pyMC_Repeater
"""

import asyncio
import datetime
import hashlib
import json
import logging
import time
from urllib.parse import urlparse, urlunparse, parse_qs

import httpx

from bus import get_bus, publish_entity, set_feed
from config import settings
from normalizers.mesh_node import normalize_pymc_repeater_advert
from sanitize import sanitize_payload
from .base import BasePoller

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 60
_RETRY_DELAY = 15
_PACKET_LIMIT = 200


class MeshCorePoller(BasePoller):
    """pyMC-Repeater poller: adverts, SNR metrics, and system health via REST + SSE."""

    name = "meshcore"
    interval = _POLL_INTERVAL

    def __init__(self):
        self._sources: list[dict] = []

    async def poll(self):
        pass  # overrides run()

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'meshcore' AND enabled = TRUE"
        )
        self._sources = [_parse_source(row["url"]) for row in rows]
        if self._sources:
            logger.info("[meshcore] %d pyMC-Repeater source(s)", len(self._sources))
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
        headers = _api_headers(src.get("api_key"))
        if src.get("companion"):
            companions = [src["companion"]]
        else:
            companions = await _discover_all_companions(src["base_url"], headers)
            if companions:
                src["companion"] = companions[0]

        if companions:
            logger.info(
                "[meshcore] %d companion(s) at %s: %s",
                len(companions), src["base_url"], ", ".join(companions),
            )
            sse_tasks = [
                asyncio.create_task(self._sse_loop(src, c)) for c in companions
            ]
        else:
            logger.info(
                "[meshcore] no companions found at %s — running poll-only mode",
                src["base_url"],
            )
            sse_tasks = []

        await asyncio.gather(
            asyncio.create_task(self._poll_loop(src)),
            *sse_tasks,
        )

    async def _poll_loop(self, src: dict):
        while True:
            try:
                await self._poll_once(src)
                await self._heartbeat("ok")
            except Exception as exc:
                logger.error("[meshcore] poll error %s: %s", src["base_url"], exc)
                await self._heartbeat("error", str(exc)[:256])
            await asyncio.sleep(_POLL_INTERVAL)

    async def _poll_once(self, src: dict):
        base_url = src["base_url"]
        headers = _api_headers(src.get("api_key"))

        async with httpx.AsyncClient(headers=headers, timeout=15) as client:
            # Node adverts
            try:
                resp = await client.get(f"{base_url}/api/adverts_by_contact_type")
                if resp.status_code == 200:
                    count = 0
                    skipped = 0
                    for advert in _iter_items(resp.json()):
                        entity = normalize_pymc_repeater_advert(advert, base_url)
                        if not entity:
                            continue
                        if not _should_publish_node(entity):
                            skipped += 1
                            continue
                        await publish_entity(entity)
                        count += 1
                    logger.debug(
                        "[meshcore] synced %d adverts from %s (%d outside region bbox)",
                        count, base_url, skipped,
                    )
            except Exception as exc:
                logger.debug("[meshcore] advert fetch error: %s", exc)

            # Recent packets → SNR / RSSI link metrics
            try:
                resp = await client.get(
                    f"{base_url}/api/recent_packets", params={"limit": _PACKET_LIMIT}
                )
                if resp.status_code == 200:
                    links = _extract_links_from_packets(resp.json(), base_url)
                    if links:
                        await _upsert_mesh_links(links)
            except Exception as exc:
                logger.debug("[meshcore] packet fetch error: %s", exc)

            # System health
            try:
                resp = await client.get(f"{base_url}/api/stats")
                if resp.status_code == 200:
                    await _publish_health(resp.json(), base_url, src.get("companion"))
            except Exception as exc:
                logger.debug("[meshcore] stats fetch error: %s", exc)

    async def _sse_loop(self, src: dict, companion_name: str):
        """Stream real-time events from a single companion SSE endpoint.

        Reconnects automatically on disconnect or error.
        """
        base_url = src["base_url"]
        headers = _api_headers(src.get("api_key"))
        sse_url = f"{base_url}/api/companion/events"
        params = {"companion": companion_name}

        while True:
            try:
                async with httpx.AsyncClient(headers=headers, timeout=None) as client:
                    async with client.stream("GET", sse_url, params=params) as resp:
                        if resp.status_code != 200:
                            logger.warning(
                                "[meshcore] SSE %s returned %d", sse_url, resp.status_code
                            )
                        else:
                            logger.info("[meshcore] SSE connected: %s", sse_url)
                            status_payload = {
                                "connected": True,
                                "url": base_url,
                                "companion": companion_name,
                            }
                            await set_feed("mesh:status", status_payload)
                            r = await get_bus()
                            await r.publish("civic:updates", json.dumps(sanitize_payload({
                                "type": "mesh_status",
                                "data": status_payload,
                            })))
                            event_type: str | None = None
                            async for raw_line in resp.aiter_lines():
                                line = raw_line.strip()
                                if line.startswith("event:"):
                                    event_type = line[6:].strip()
                                elif line.startswith("data:"):
                                    payload_str = line[5:].strip()
                                    if payload_str:
                                        try:
                                            await self._handle_sse_event(
                                                event_type, json.loads(payload_str), base_url
                                            )
                                        except Exception as exc:
                                            logger.debug("[meshcore] SSE event error: %s", exc)
                                    event_type = None
            except Exception as exc:
                logger.error(
                    "[meshcore] SSE error (%s): %s — retry in %ds",
                    sse_url, exc, _RETRY_DELAY,
                )

            status_payload = {
                "connected": False,
                "url": base_url,
                "companion": companion_name,
            }
            await set_feed("mesh:status", status_payload)
            r = await get_bus()
            await r.publish("civic:updates", json.dumps(sanitize_payload({
                "type": "mesh_status",
                "data": status_payload,
            })))
            await asyncio.sleep(_RETRY_DELAY)

    async def _handle_sse_event(self, event_type: str | None, data: dict, base_url: str):
        if not event_type and isinstance(data, dict):
            event_type = data.get("event")

        payload = data.get("arg0") if isinstance(data.get("arg0"), dict) else data

        if event_type == "advert_received":
            entity = normalize_pymc_repeater_advert(payload, base_url)
            if entity and _should_publish_node(entity):
                await publish_entity(entity)

        elif event_type in ("message_received", "channel_message_received"):
            message = _normalize_repeater_message(data, base_url, event_type)
            try:
                await _save_mesh_message(message)
            except Exception as exc:
                logger.warning("[meshcore] persist message failed: %s", exc)
            r = await get_bus()
            await r.publish("civic:updates", json.dumps(sanitize_payload({
                "type": "mesh_message",
                "data": message,
            })))

        elif event_type == "contact_path_updated":
            entity = normalize_pymc_repeater_advert(payload, base_url)
            if entity and _should_publish_node(entity):
                await publish_entity(entity, merge=True, record_observation=False)


# ─── helpers ──────────────────────────────────────────────────────────────────

def _in_region(lat: float, lon: float) -> bool:
    """True when the coordinates fall inside any configured region bbox (padded)."""
    from config import load_regions
    pad = settings.mesh_bbox_pad_deg
    for region in load_regions():
        b = region.bbox
        if (b.min_lat - pad) <= lat <= (b.max_lat + pad) \
                and (b.min_lon - pad) <= lon <= (b.max_lon + pad):
            return True
    return False


def _should_publish_node(entity: dict) -> bool:
    """Bbox gate for mesh_node entities, like the ADS-B/AIS/Amtrak pollers.

    Nodes with no advertised position always pass — they cannot clutter the
    map, and direct RF neighbors often advertise without GPS.
    """
    if not settings.mesh_bbox_filter:
        return True
    lat, lon = entity.get("lat"), entity.get("lon")
    if lat is None or lon is None:
        return True
    return _in_region(lat, lon)


def _parse_source(url: str) -> dict:
    """Extract API key and companion from URL; return clean base_url, api_key, and companion."""
    parsed = urlparse(url)
    api_key = None
    companion = None
    if parsed.query:
        qs = parse_qs(parsed.query)
        if "companion" in qs:
            companion = qs["companion"][0]

    if parsed.username:
        api_key = parsed.username
        netloc = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
        url = urlunparse(parsed._replace(netloc=netloc, query=""))
    else:
        url = urlunparse(parsed._replace(query=""))
    return {"base_url": url.rstrip("/"), "api_key": api_key, "companion": companion}


def _api_headers(api_key: str | None) -> dict[str, str]:
    if not api_key:
        return {}
    return {"X-API-Key": api_key}


def _iter_items(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("items", "adverts", "contacts", "data"):
            v = payload.get(key)
            if isinstance(v, list):
                return v
    return []


async def _discover_all_companions(base_url: str, headers: dict) -> list[str]:
    """Return all companion names from /api/companion/index."""
    try:
        async with httpx.AsyncClient(headers=headers, timeout=10) as client:
            resp = await client.get(f"{base_url}/api/companion/index")
            if resp.status_code != 200:
                return []
            names: list[str] = []
            for item in _iter_items(resp.json()):
                if isinstance(item, dict):
                    name = item.get("name") or item.get("identity_name")
                    if name:
                        names.append(str(name))
            return names
    except Exception as exc:
        logger.debug("[meshcore] companion discovery error: %s", exc)
    return []


def _extract_links_from_packets(payload, source_url: str) -> list[dict]:
    """Deduplicate per-sender SNR/RSSI from the recent-packet list."""
    packets = _iter_items(payload)
    now = time.time()
    links: list[dict] = []
    seen: set[str] = set()

    for pkt in packets:
        if not isinstance(pkt, dict):
            continue
        pkt_data = pkt.get("data") or pkt
        if not isinstance(pkt_data, dict):
            continue

        snr = pkt_data.get("snr") or pkt_data.get("rx_snr")
        rssi = pkt_data.get("rssi") or pkt_data.get("rx_rssi")
        sender = (
            pkt_data.get("sender_pubkey")
            or pkt_data.get("from_pubkey")
            or pkt_data.get("sender")
            or pkt_data.get("from")
        )
        ts = pkt_data.get("timestamp") or pkt_data.get("rx_time") or now

        if not sender or snr is None:
            continue

        node_b = (
            f"mesh_node:{sender}"
            if not str(sender).startswith("mesh_node:")
            else str(sender)
        )
        if node_b in seen:
            continue
        seen.add(node_b)

        age_secs = max(0.0, now - float(ts)) if isinstance(ts, (int, float)) else 0.0
        links.append({
            "source_url": source_url,
            "node_a": "local",
            "node_b": node_b,
            "snr": float(snr),
            "rssi": float(rssi) if rssi is not None else None,
            "secs_ago": age_secs,
        })

    return links


async def _upsert_mesh_links(links: list[dict]) -> None:
    from db import get_pool
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    rows = [
        (
            lnk["source_url"],
            lnk["node_a"],
            lnk["node_b"],
            lnk.get("snr"),
            None,
            now_utc - datetime.timedelta(seconds=int(lnk.get("secs_ago", 0))),
        )
        for lnk in links
    ]
    await get_pool().executemany(
        """
        INSERT INTO mesh_links (source_url, node_a, node_b, snr, link_quality, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_url, node_a, node_b) DO UPDATE SET
            snr          = EXCLUDED.snr,
            link_quality = COALESCE(EXCLUDED.link_quality, mesh_links.link_quality),
            last_seen    = GREATEST(mesh_links.last_seen, EXCLUDED.last_seen)
        """,
        rows,
    )
    r = await get_bus()
    await r.publish("civic:updates", json.dumps({
        "type": "mesh_links",
        "data": [
            {
                "source_url": lnk["source_url"],
                "node_a":     lnk["node_a"],
                "node_b":     lnk["node_b"],
                "snr":        lnk.get("snr"),
                "link_quality": None,
            }
            for lnk in links
        ],
    }))


async def _publish_health(stats: dict, base_url: str, companion: str | None = None) -> None:
    if not isinstance(stats, dict):
        return
    connected = stats.get("radio_connected", stats.get("connected", True))
    uptime = stats.get("uptime_seconds") or stats.get("uptime_secs")
    payload = {
        "connected": connected,
        "url": base_url,
        "uptime_secs": uptime,
        "version": stats.get("version"),
        "site_name": stats.get("site_name"),
        "companion": companion,
    }
    await set_feed("mesh:status", payload)
    
    # Process neighbors from stats and publish as mesh_node entities
    neighbors = stats.get("neighbors", {})
    if isinstance(neighbors, dict):
        for pub_key, node in neighbors.items():
            if not isinstance(node, dict):
                continue
            node_copy = dict(node)
            node_copy["public_key"] = pub_key
            node_copy["name"] = node.get("node_name")
            entity = normalize_pymc_repeater_advert(node_copy, base_url)
            if entity and _should_publish_node(entity):
                await publish_entity(entity)

    r = await get_bus()
    await r.publish("civic:updates", json.dumps(sanitize_payload({
        "type": "mesh_status",
        "data": payload,
    })))


def _normalize_repeater_message(data: dict, source_url: str, event_type: str) -> dict:
    if "arg2" in data and "arg6" in data:
        text = data.get("arg2") or ""
        sender_pubkey = data.get("arg6") or "unknown"
        sender_prefix = data.get("arg1") or str(sender_pubkey)[:8]
        ts_raw = data.get("arg3") or data.get("timestamp")
        companion = data.get("arg0") or "public"
    else:
        text = data.get("message_text") or data.get("text") or data.get("body") or ""
        sender_pubkey = (
            data.get("author_pubkey")
            or data.get("public_key")
            or data.get("from")
            or "unknown"
        )
        sender_prefix = data.get("author_prefix") or str(sender_pubkey)[:8]
        ts_raw = (
            data.get("post_timestamp")
            or data.get("sender_timestamp")
            or data.get("timestamp")
        )
        companion = (
            data.get("companion")
            or data.get("room")
            or data.get("identity_name")
            or "public"
        )

    ts = str(ts_raw) if ts_raw is not None else ""
    msg_type = "channel" if event_type == "channel_message_received" else "direct"
    fingerprint = f"{source_url}|{companion}|{sender_pubkey}|{ts}|{text}"
    message_id = hashlib.sha1(fingerprint.encode("utf-8", errors="ignore")).hexdigest()
    return {
        "id":               message_id,
        "msg_type":         msg_type,
        "conversation_key": companion,
        "channel_name":     companion,
        "text":             str(text),
        "sender_name":      sender_prefix,
        "sender_key":       str(sender_pubkey),
        "outgoing":         False,
        "acked":            False,
        "timestamp":        ts,
        "source_url":       source_url,
    }


async def _save_mesh_message(message: dict) -> None:
    from db import get_pool

    ts_raw = message.get("timestamp")
    try:
        val = float(ts_raw) if ts_raw else None
        ts = (
            datetime.datetime.fromtimestamp(val, tz=datetime.timezone.utc)
            if val
            else datetime.datetime.now(datetime.timezone.utc)
        )
    except Exception:
        ts = datetime.datetime.now(datetime.timezone.utc)

    await get_pool().execute(
        """
        INSERT INTO mesh_messages
            (id, msg_type, conversation_key, channel_name, text,
             sender_name, sender_key, outgoing, acked, ts, source_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id) DO UPDATE SET
            msg_type         = EXCLUDED.msg_type,
            conversation_key = EXCLUDED.conversation_key,
            channel_name     = EXCLUDED.channel_name,
            text             = EXCLUDED.text,
            sender_name      = EXCLUDED.sender_name,
            sender_key       = EXCLUDED.sender_key,
            outgoing         = EXCLUDED.outgoing,
            acked            = EXCLUDED.acked,
            ts               = EXCLUDED.ts,
            source_url       = EXCLUDED.source_url
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
        message.get("source_url"),
    )
