"""Select reviewed built-in adapters at startup; each keeps the BasePoller lifecycle."""
import asyncio
import json
import logging
import os

from provider_catalog import (CONTRACT_IDS, SELECTION_KEY, provider_plan, selected_ids, selection_signature)
from pack_support import discover
from region_sync import _read_stored, env_locked

logger = logging.getLogger(__name__)


async def resolve_startup(pool, settings):
    row = await pool.fetchrow("SELECT value FROM app_settings WHERE key=$1", SELECTION_KEY)
    choice = row["value"] if row else None
    if isinstance(choice, str):
        choice = json.loads(choice)
    stored = None if env_locked(settings) else await _read_stored(pool)
    ids = choice["packs"] if choice is not None else selected_ids(stored or {})
    installed = await asyncio.to_thread(discover, os.environ.get("REGION_PACKS_DIR", "/regions"), CONTRACT_IDS)
    valid = {p["id"]: p for p in installed if p.get("valid")}
    bbox = {k: getattr(settings, "bbox_" + k) for k in ("min_lat", "max_lat", "min_lon", "max_lon")}
    plan, errors = provider_plan(ids, valid, settings, bbox)
    return plan, errors, choice


def build_pollers(plan):
    from regional_adapters import odf_fire_danger, traffic, utilities
    from pollers.wsdot import WsdotPoller
    factories = {"odot-tripcheck": traffic.TrafficPoller, "oregon-odin": utilities.UtilityPoller,
                 "odf-fire-danger": odf_fire_danger.OdfFireDangerPoller, "wsdot-travel": WsdotPoller}
    from pollers.gtfs_rt import GtfsRtPoller, declared_source
    from transit_sources import SOURCES
    for pid in SOURCES:
        factories[pid] = lambda pid=pid: GtfsRtPoller(pid)
    from provider_catalog import PROVIDERS
    from pollers.arcgis_fire_danger import ArcgisFireDangerPoller
    from pollers.wzdx import WzdxPoller
    pollers = []
    for pid, p in plan.items():
        if p["reason"] or not p["contracts"]:
            continue
        entry = PROVIDERS[pid]
        if entry.get("kind") == "gtfs_rt":
            pollers.append(GtfsRtPoller(pid, declared_source(pid, entry["declarative"])))
        elif entry.get("kind") == "wzdx":
            pollers.append(WzdxPoller(pid, entry["declarative"]))
        elif entry.get("declarative"):
            pollers.append(ArcgisFireDangerPoller(pid, entry["declarative"]))
        else:
            pollers.append(factories[pid]())
    return pollers


async def start_providers(pool, settings, redis):
    from bus import set_feed
    from provider_feeds import configure, reconcile
    plan, errors, choice = await resolve_startup(pool, settings)
    configure(plan)
    await reconcile(redis, set_feed)
    from pollers.gtfs_rt import declared_source
    from provider_catalog import PROVIDERS
    from transit_sources import SOURCES
    active = set()
    for pid, provider in plan.items():
        if provider["reason"]:
            continue
        if pid in SOURCES:
            active.add(SOURCES[pid]["name"])
        elif PROVIDERS.get(pid, {}).get("kind") == "gtfs_rt":
            active.add(declared_source(pid, PROVIDERS[pid]["declarative"])["name"])
    # Anything left from an agency that is no longer in use (pack deselected, key removed, outside coverage) goes.
    async for key in redis.scan_iter(match="transit:entities:*"):
        key = key.decode() if isinstance(key, bytes) else key
        name = key.rsplit(":", 1)[-1]
        if name in active:
            continue
        for eid in await redis.smembers(key):
            eid = eid.decode() if isinstance(eid, bytes) else eid
            await redis.delete('entity:' + eid)
            await redis.publish('civic:updates', json.dumps({'type': 'entity_remove', 'data': {'entity_id': eid}}))
        await redis.delete(key)
    # Static-only agencies keep route shapes and stops but no vehicles.
    for kind in ("paths", "stops", "alerts"):
        async for key in redis.scan_iter(match="cache:transit:*:" + kind):
            key = key.decode() if isinstance(key, bytes) else key
            if key.split(":")[2] not in active:
                await redis.delete(key)
    # The legacy wrapper heartbeat is no longer a collector.
    await redis.hdel('metrics:poller_heartbeats', 'gtfs_rt')
    await redis.hset("region:poller", "packs_signature", selection_signature(choice) if choice is not None else "")
    await redis.set("region:providers", json.dumps({"providers": plan, "errors": errors}))
    for pid, provider in plan.items():
        logger.info("[providers] %s: %s", pid, provider["reason"] or "enabled")
    for pack_id, reason in errors.items():
        logger.warning("[providers] %s: %s", pack_id, reason)
    return build_pollers(plan)
