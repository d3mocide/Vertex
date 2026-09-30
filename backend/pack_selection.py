"""Persist pack selection separately from the map center, including env-pinned regions."""
import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import text

import region_config
from config_writer import pack_feed_config
from db.models import AppSetting
from pack_feeds import sync_pack_feeds
from provider_catalog import PROVIDERS, SELECTION_KEY, combined_feeds


def validate_choice(ids, installed):
    try:
        ids = region_config.normalize_packs(ids)
    except region_config.RegionError as exc:
        raise HTTPException(422, str(exc)) from exc
    for pid in ids:
        if pid not in installed:
            raise HTTPException(422, f"pack {pid!r} is not installed (or is invalid)")
        if any(p["id"] not in PROVIDERS for p in installed[pid].get("providers", [])):
            raise HTTPException(422, f"pack {pid!r} contains an unsupported built-in provider")
    return ids


async def load_selection(db):
    row = await db.get(AppSetting, SELECTION_KEY, populate_existing=True)
    return row.value if row else None


async def save_selection(db, ids, installed, save_region=None):
    ids = validate_choice(ids, installed)
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('vertex:region-setup'))"))
    choice_row = await db.get(AppSetting, SELECTION_KEY, populate_existing=True)
    try:
        async with pack_feed_config(combined_feeds(ids, installed)) as sources:
            await sync_pack_feeds(db, sources)
            feed_config = {s: sources.get(s, []) for s in ("news_feeds", "alert_feeds")}
            choice = {"packs": ids,
                      "feeds_signature": hashlib.sha256(json.dumps(feed_config, sort_keys=True).encode()).hexdigest()}
            if choice_row:
                choice_row.value = choice
            else:
                db.add(AppSetting(key=SELECTION_KEY, value=choice))
            if save_region:
                await save_region(choice["feeds_signature"])
            await db.commit()
    except (OSError, ValueError):
        await db.rollback()
        raise HTTPException(503, "Could not persist region pack feeds; check sources.yml permissions and format.") from None
    except Exception:
        await db.rollback()
        raise
