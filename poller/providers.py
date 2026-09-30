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
    from pollers.wadnr_fire_danger import WadnrFireDangerPoller
    factories = {"odot-tripcheck": traffic.TrafficPoller, "oregon-odin": utilities.UtilityPoller,
                 "odf-fire-danger": odf_fire_danger.OdfFireDangerPoller, "wsdot-travel": WsdotPoller, "wadnr-fire-danger": WadnrFireDangerPoller}
    return [factories[pid]() for pid, p in plan.items() if not p["reason"] and p["contracts"]]


async def start_providers(pool, settings, redis):
    from bus import set_feed
    from provider_feeds import configure, reconcile
    plan, errors, choice = await resolve_startup(pool, settings)
    configure(plan)
    await reconcile(redis, set_feed)
    await redis.hset("region:poller", "packs_signature", selection_signature(choice) if choice is not None else "")
    await redis.set("region:providers", json.dumps({"providers": plan, "errors": errors}))
    for pid, provider in plan.items():
        logger.info("[providers] %s: %s", pid, provider["reason"] or "enabled")
    for pack_id, reason in errors.items():
        logger.warning("[providers] %s: %s", pack_id, reason)
    return build_pollers(plan)
