"""
Advisory feed — the ranked list behind the top-of-app advisory bar.

Every 30 s, read the latest NWS alerts, radio incidents, ODOT incidents and
FlashAlert notices from Redis, promote what matters by the rules in
advisories.py, and publish `feed:advisories` (only when it changes).
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

import advisories as adv
from bus import get_bus, set_feed, touch_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)


async def _feed(r, key: str, default):
    raw = await r.get(f"feed:{key}")
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


async def build(r, now: datetime) -> dict:
    home = (settings.region_lat, settings.region_lon)
    radio = await _feed(r, "radio:incidents", {})
    places = [p.strip() for p in settings.advisory_places.split(",") if p.strip()]
    candidates = (
        adv.from_nws(await _feed(r, "weather:alerts", []), now)
        + adv.from_radio(radio.get("incidents") or [], now, home, settings.advisory_radius_km,
                         timedelta(minutes=settings.advisory_radio_max_age_minutes))
        + adv.from_traffic(await _feed(r, "traffic:incidents", []), now, settings.advisory_radius_km,
                           timedelta(hours=settings.advisory_traffic_max_age_hours))
        + adv.from_flashalert(await _feed(r, "alerts:flash", []), places)
    )
    return adv.rank(candidates)


class AdvisoryPoller(BasePoller):
    name = "advisory"
    interval = 30

    def __init__(self):
        self._last_hash = ""

    async def poll(self):
        now = datetime.now(timezone.utc)
        r = await get_bus()
        body = await build(r, now)
        # "x min ago" in the details changes every minute; hash the rest.
        stable = [{k: v for k, v in i.items() if k != "detail"} for i in body["items"]]
        digest = hashlib.sha1(json.dumps([body["level"], stable], sort_keys=True, default=str).encode()).hexdigest()
        minute = now.strftime("%Y%m%d%H%M")
        if digest + minute == self._last_hash:
            await touch_feed("advisories")
            return
        changed = not self._last_hash.startswith(digest)
        self._last_hash = digest + minute
        await set_feed("advisories", {"ts": now.isoformat(), **body})
        if changed:
            logger.info("[advisory] level=%s, %d advisories%s", body["level"], body["count"],
                        (": " + "; ".join(f"{i['level']} {i['title']}" for i in body["items"][:3])) if body["items"] else "")
