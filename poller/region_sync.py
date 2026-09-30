"""Follow the operator's region when it is set in the app instead of the environment.

Precedence matches the backend (backend/region_config.py): REGION_LAT / REGION_LON in the environment
win; otherwise the region stored in ``app_settings`` is applied to ``settings`` before any poller is
built. Pollers read region settings all over the place, so instead of hot-swapping them the poller
restarts itself (Docker brings it back) when the stored region changes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal

logger = logging.getLogger(__name__)

REGION_KEY = "region"
CHECK_INTERVAL_S = 30


def env_locked(settings) -> bool:
    fields_set = getattr(settings, "model_fields_set", set())
    return "region_lat" in fields_set or "region_lon" in fields_set


async def _read_stored(pool) -> tuple[dict | None, str | None]:
    """The stored region and a signature that changes whenever it does; (None, None) if absent."""
    try:
        row = await pool.fetchrow("SELECT value, updated_at FROM app_settings WHERE key = $1", REGION_KEY)
    except Exception as exc:  # table not created yet (backend not started) or DB hiccup
        logger.debug("[region] could not read app_settings: %s", exc)
        return None, None
    if not row:
        return None, None
    value = row["value"]
    if isinstance(value, str):
        value = json.loads(value)
    return value, f"{row['updated_at']}|{json.dumps(value, sort_keys=True)}"


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


async def apply_stored_region(pool, settings) -> str | None:
    """Apply the stored region at startup. Returns its signature (to watch for changes), or None when
    the environment pins the region or nothing is stored."""
    if env_locked(settings):
        logger.info("[region] REGION_LAT/REGION_LON set in the environment — using them")
        return None
    stored, signature = await _read_stored(pool)
    if not stored:
        logger.info("[region] no region stored in the database — using configured defaults")
        return None
    apply(settings, stored)
    logger.info("[region] applied stored region %r (%.4f, %.4f)", settings.region_name,
                settings.region_lat, settings.region_lon)
    return signature


async def watch_region(pool, settings, applied_signature: str | None) -> None:
    """Restart the process when the stored region changes, so every poller picks it up."""
    if env_locked(settings):
        return
    while True:
        await asyncio.sleep(CHECK_INTERVAL_S)
        _, signature = await _read_stored(pool)
        if signature != applied_signature:
            logger.warning("[region] stored region changed — restarting to apply it")
            os.kill(os.getpid(), signal.SIGTERM)
            return
