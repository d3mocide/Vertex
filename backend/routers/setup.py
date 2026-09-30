"""First-run setup: is the app configured, which region packs are installed, and does the poller need a restart.

Saving the choice is ``PUT /config/region`` (see routers/region.py); this router only answers the
questions the setup wizard asks along the way.
"""
import os

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

import pack_registry
import packs
import region_config
from capabilities import CONTRACTS
from deps import get_db
from redis_bus import get_redis
from routers.region import load_effective, load_stored

router = APIRouter(prefix="/setup", tags=["setup"])
_TITLES = {c.id: c.title for c in CONTRACTS}


async def _poller_state() -> dict:
    """What the poller reported about the region (it writes this at startup)."""
    try:
        raw = await get_redis().hgetall("region:poller")
    except Exception:
        return {}
    return {(k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v)
            for k, v in raw.items()}


@router.get("/status")
async def setup_status(db: AsyncSession = Depends(get_db)):
    """Whether setup is needed, and whether a saved region still needs a poller restart to take effect."""
    eff = await load_effective(db)
    stored, _ = await load_stored(db)
    poller = await _poller_state()
    state = poller.get("state") or "unknown"
    restart_required = bool(
        eff["source"] == "database" and stored and state == "applied"
        and poller.get("signature") != region_config.signature(stored)
    )
    return {
        "needs_setup": eff["source"] == "default",
        "source": eff["source"],
        "locked": eff["locked"],
        "locked_by": eff["locked_by"],
        "pack": eff["pack"],
        "poller": {"state": state, "region": poller.get("name") or None},
        "restart_required": restart_required,
    }


@router.get("/packs")
async def list_packs(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    state: str | None = Query(None, min_length=2, max_length=2),
):
    """Installed region packs, the ones covering a location first. Reports which keys each needs and
    whether they are already present in the environment (never their values)."""
    out = []
    for p in pack_registry.installed():
        if not p["valid"]:
            out.append({**p, "suggested": False})
            continue
        suggested = lat is not None and lon is not None and packs.covers_point(p, lat, lon, state)
        out.append({
            **{k: p[k] for k in ("id", "name", "description", "maintainers", "covers", "valid", "error")},
            "provides": [{"id": c, "title": _TITLES.get(c, c)} for c in p["provides"]],
            "keys": packs.key_status(p, os.environ),
            "suggested": suggested,
        })
    out.sort(key=lambda p: (not p.get("suggested"), not p.get("valid"), p["name"].lower()))
    return out
