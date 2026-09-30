"""Follow the operator's region when it is chosen in the setup wizard instead of the environment.

Precedence matches the backend (backend/region_config.py): REGION_LAT / REGION_LON in the environment
win; otherwise the region stored in ``app_settings`` is applied to ``settings`` before any poller is
built. On a fresh install with neither, the poller waits (SETUP_GATE, on by default) until the wizard
saves a region, so it never fills the database with data for the wrong place. There is no live
reload: changing the region later means running the wizard again and restarting the poller, and the
setup screen says when that is needed (it compares the region this process applied with the stored one).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging

logger = logging.getLogger(__name__)

REGION_KEY = "region"
STATE_KEY = "region:poller"     # Redis hash the backend reads to tell the operator whether a restart is needed
POLL_S = 10
LOG_EVERY_S = 60


def signature(stored: dict) -> str:
    """Stable fingerprint of a stored region. Must match backend/region_config.signature."""
    return hashlib.sha1(json.dumps(stored, sort_keys=True).encode()).hexdigest()[:16]


def env_locked(settings) -> bool:
    fields_set = getattr(settings, "model_fields_set", set())
    return "region_lat" in fields_set or "region_lon" in fields_set


async def _read_stored(pool) -> dict | None:
    try:
        row = await pool.fetchrow("SELECT value FROM app_settings WHERE key = $1", REGION_KEY)
    except Exception as exc:  # table not created yet (backend not started) or a DB hiccup
        logger.debug("[region] could not read app_settings: %s", exc)
        return None
    if not row:
        return None
    value = row["value"]
    return json.loads(value) if isinstance(value, str) else value


def apply(settings, stored: dict) -> None:
    """Copy a stored region onto the settings object (never overriding explicit environment values)."""
    settings.region_lat = float(stored["lat"])
    settings.region_lon = float(stored["lon"])
    settings.region_name = stored.get("name") or settings.region_name
    settings.region_timezone = stored.get("timezone") or settings.region_timezone
    for k, attr in (("min_lat", "bbox_min_lat"), ("max_lat", "bbox_max_lat"),
                    ("min_lon", "bbox_min_lon"), ("max_lon", "bbox_max_lon")):
        setattr(settings, attr, float(stored["bbox"][k]))
    office = (stored.get("nws") or {}).get("office")
    if office and "nws_office" not in getattr(settings, "model_fields_set", set()):
        settings.nws_office = office


async def _publish(redis, state: str, sig: str | None, name: str | None) -> None:
    """Tell the backend what this process is doing about the region (best effort)."""
    if redis is None:
        return
    try:
        await redis.hset(STATE_KEY, mapping={"state": state, "signature": sig or "", "name": name or ""})
    except Exception as exc:
        logger.debug("[region] could not publish state: %s", exc)


async def apply_or_wait(pool, settings, redis=None, *, sleep=asyncio.sleep) -> str:
    """Settle the region before any poller starts. Returns 'env', 'database' or 'default'."""
    if env_locked(settings):
        logger.info("[region] REGION_LAT/REGION_LON set in the environment — using them")
        await _publish(redis, "env", None, settings.region_name)
        return "env"

    waited = 0
    while True:
        stored = await _read_stored(pool)
        if stored:
            apply(settings, stored)
            logger.info("[region] applied region %r (%.4f, %.4f)", settings.region_name,
                        settings.region_lat, settings.region_lon)
            await _publish(redis, "applied", signature(stored), settings.region_name)
            return "database"
        if not getattr(settings, "setup_gate", True):
            logger.info("[region] no region chosen and SETUP_GATE is off — using the built-in defaults")
            await _publish(redis, "default", None, settings.region_name)
            return "default"
        if waited % LOG_EVERY_S == 0:
            logger.warning("[region] waiting for setup: choose a region in the app (Setup wizard) — "
                           "no pollers are running until then. Set SETUP_GATE=false to skip.")
        await _publish(redis, "waiting", None, None)
        await sleep(POLL_S)
        waited += POLL_S
