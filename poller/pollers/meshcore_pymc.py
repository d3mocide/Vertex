"""
MeshCore pyMC poller — direct device access via the `meshcore` Python library.

Connects to a MeshCore device over TCP or serial and retrieves the full
contact list plus the per-contact neighbour tables.  Unlike the RemoteTerm
poller, this path captures SNR as *measured by each remote node*, giving
bi-directional link metrics for every hop in the mesh.

Configure poller_sources with type=meshcore_pymc and a connection URL:
  tcp://192.168.1.x:5000           TCP (e.g. via socat serial-to-TCP bridge)
  serial:///dev/ttyUSB0            serial at 115 200 baud (default)
  serial:///dev/ttyACM0?baudrate=9600

Requires: pip install meshcore
"""
import asyncio
import datetime
import json
import logging
import time
from urllib.parse import urlparse, parse_qs

from bus import get_bus, publish_entity
from .base import BasePoller

try:
    from meshcore import MeshCore
    _MESHCORE_AVAILABLE = True
except ImportError:
    MeshCore = None  # type: ignore[assignment,misc]
    _MESHCORE_AVAILABLE = False

logger = logging.getLogger(__name__)

_CONTACT_POLL_INTERVAL = 120   # seconds between full refresh cycles
_NEIGHBOUR_TIMEOUT = 10         # seconds to await each node's neighbour response
_RETRY_DELAY = 30

_CONTACT_TYPES = {0: "unknown", 1: "client", 2: "repeater", 3: "room", 4: "sensor"}


def _parse_url(url: str) -> tuple[str, dict]:
    """Return (kind, params) for 'tcp' or 'serial' connection URLs."""
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme == "tcp":
        return "tcp", {
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 5000,
        }
    if scheme == "serial":
        qs = parse_qs(parsed.query)
        return "serial", {
            "port": parsed.path,
            "baudrate": int(qs.get("baudrate", [115200])[0]),
        }
    raise ValueError(
        f"Unsupported meshcore_pymc URL scheme {scheme!r}. Use tcp:// or serial://"
    )


def _find_full_pubkey(contacts: dict, prefix: str) -> str | None:
    """Match a neighbour's pubkey prefix against the full contact table."""
    for pk in contacts:
        if pk.startswith(prefix):
            return pk
    return None


def _contact_to_entity(contact: dict, source_url: str) -> dict | None:
    pub_key = contact.get("public_key", "")
    if not pub_key:
        return None

    name = (contact.get("adv_name") or "").strip() or pub_key[:12]
    contact_type = _CONTACT_TYPES.get(contact.get("type", 0), "unknown")

    lat = contact.get("adv_lat")
    lon = contact.get("adv_lon")
    if lat == 0.0 and lon == 0.0:
        lat = lon = None

    return {
        "entity_id":    f"mesh_node:{pub_key}",
        "entity_type":  "mesh_node",
        "source":       "meshcore_pymc",
        "display_name": name,
        "lat":          lat,
        "lon":          lon,
        "identity": {
            "public_key":   pub_key,
            "node_id":      pub_key[:12],
            "short_name":   name[:12],
            "contact_type": contact_type,
            "last_advert":  contact.get("last_advert"),
            "source_url":   source_url,
        },
        "tags": ["mesh_node", contact_type],
    }


async def _upsert_pymc_links(links: list[dict]) -> None:
    from db import get_pool
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    rows = [
        (
            lnk["source_url"],
            lnk["node_a"],
            lnk["node_b"],
            lnk.get("snr"),
            None,  # link_quality — not available via pyMC neighbour table
            now_utc - datetime.timedelta(seconds=int(lnk.get("secs_ago", 0))),
        )
        for lnk in links
    ]
    await get_pool().executemany(
        """
        INSERT INTO mesh_links (source_url, node_a, node_b, snr, link_quality, last_seen)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_url, node_a, node_b) DO UPDATE SET
            snr        = EXCLUDED.snr,
            link_quality = COALESCE(EXCLUDED.link_quality, mesh_links.link_quality),
            last_seen  = GREATEST(mesh_links.last_seen, EXCLUDED.last_seen)
        """,
        rows,
    )
    r = await get_bus()
    await r.publish("civic:updates", json.dumps({
        "type": "mesh_links",
        "data": [
            {
                "source_url":   lnk["source_url"],
                "node_a":       lnk["node_a"],
                "node_b":       lnk["node_b"],
                "snr":          lnk.get("snr"),
                "link_quality": None,
            }
            for lnk in links
        ],
    }))


class MeshCorePymcPoller(BasePoller):
    """Direct pyMC poller: contacts + remote-node neighbour SNR tables."""

    name = "meshcore_pymc"
    interval = _CONTACT_POLL_INTERVAL

    def __init__(self):
        self._sources: list[str] = []

    async def poll(self):
        pass  # Overrides run()

    async def setup(self):
        if not _MESHCORE_AVAILABLE:
            logger.error(
                "[meshcore_pymc] 'meshcore' package not installed — "
                "run: pip install meshcore"
            )
            return
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources "
            "WHERE type = 'meshcore_pymc' AND enabled = TRUE"
        )
        self._sources = [row["url"] for row in rows]
        if self._sources:
            logger.info("[meshcore_pymc] %d source(s) configured", len(self._sources))
        else:
            logger.info("[meshcore_pymc] no sources configured — poller inactive")

    async def run(self):
        await self.setup()
        if not self._sources or not _MESHCORE_AVAILABLE:
            return
        await asyncio.gather(*[
            asyncio.create_task(self._run_source(url))
            for url in self._sources
        ])

    async def _run_source(self, url: str):
        while True:
            try:
                await self._poll_once(url)
                await self._heartbeat("ok")
            except Exception as exc:
                logger.error("[meshcore_pymc] %s: %s", url, exc)
                await self._heartbeat("error", str(exc)[:256])
            await asyncio.sleep(_CONTACT_POLL_INTERVAL)

    async def _poll_once(self, url: str):
        kind, params = _parse_url(url)
        mc = None
        try:
            if kind == "tcp":
                mc = await MeshCore.create_tcp(
                    params["host"], params["port"],
                    only_error=True, default_timeout=15, auto_reconnect=False,
                )
            else:
                mc = await MeshCore.create_serial(
                    params["port"], params["baudrate"],
                    only_error=True, default_timeout=15, auto_reconnect=False,
                )

            if mc is None:
                logger.warning("[meshcore_pymc] could not connect: %s", url)
                return

            await mc.ensure_contacts()
            contacts: dict = mc.contacts
            logger.debug("[meshcore_pymc] %s: %d contacts", url, len(contacts))

            # Publish canonical entities for every known contact
            for contact in contacts.values():
                entity = _contact_to_entity(contact, url)
                if entity:
                    await publish_entity(entity, ttl=_CONTACT_POLL_INTERVAL * 3)

            # Fetch neighbour tables — one binary request per contact node.
            # Each response reports the SNR that *that node* measured for each
            # of its neighbours, giving us remote-node signal metrics.
            for contact in contacts.values():
                await self._fetch_neighbours(mc, contact, contacts, url)

        finally:
            if mc is not None:
                try:
                    await mc.disconnect()
                except Exception:
                    pass

    async def _fetch_neighbours(
        self,
        mc: "MeshCore",
        contact: dict,
        all_contacts: dict,
        source_url: str,
    ) -> None:
        label = contact.get("adv_name") or contact["public_key"][:12]
        try:
            result = await mc.commands.fetch_all_neighbours(
                contact, timeout=_NEIGHBOUR_TIMEOUT
            )
        except Exception as exc:
            logger.debug("[meshcore_pymc] neighbour fetch skipped (%s): %s", label, exc)
            return

        if not result or not result.get("neighbours"):
            return

        node_a_id = f"mesh_node:{contact['public_key']}"
        links = []
        for nb in result["neighbours"]:
            peer_pk = _find_full_pubkey(all_contacts, nb["pubkey"]) or nb["pubkey"]
            links.append({
                "source_url": source_url,
                "node_a":     node_a_id,
                "node_b":     f"mesh_node:{peer_pk}",
                "snr":        nb.get("snr"),
                "secs_ago":   nb.get("secs_ago", 0),
            })

        if links:
            await _upsert_pymc_links(links)
            logger.debug(
                "[meshcore_pymc] %s: %d links from %s",
                source_url, len(links), label,
            )
