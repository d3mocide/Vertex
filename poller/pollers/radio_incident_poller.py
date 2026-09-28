"""
Radio incident feed — structured incidents extracted from P25 dispatch transcripts.

Every minute, re-extract incidents from the last N hours of transcribed
calls (see radio_incidents.py), tag any located ones with geofences, and
publish `feed:radio:incidents` for the UI and the AI briefing. The feed is
only republished when its content changes.
"""
import asyncio
import hashlib
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from bus import get_bus, set_feed, touch_feed
from config import settings
from db import get_pool
from geocoder import Geocoder
from geo_tags import geofences_for_points
from radio_incidents import extract
from .base import BasePoller

logger = logging.getLogger(__name__)

# Most significant incidents published, plus every located one (the map's
# pins: capping by severity alone hid ~85% of them); the rest are only counted.
_MAX_PUBLISHED = 150
# New (uncached) addresses geocoded per minute — keeps the geocoder load
# gentle; the first backlog fills in over a few cycles.
_LIVE_LOOKUPS_PER_CYCLE = 25


async def load_incidents(pool, since: datetime, geocoder=None, live_lookups: int = 0):
    """Extract ranked incidents from transcripts recorded since `since`.

    With a geocoder, locate incidents from its cache; up to `live_lookups`
    uncached locations are resolved against the geocoding service (most
    significant incidents first, since the list is ranked).
    """
    rows = await pool.fetch(
        "SELECT started_at, tgid, tag, transcription FROM p25_recordings "
        "WHERE started_at >= $1 AND length(coalesce(transcription, '')) >= 20 "
        "ORDER BY started_at",
        since,
    )
    incidents = extract([tuple(r) for r in rows])
    if geocoder is not None and geocoder.enabled:
        for inc in incidents:
            entry = await geocoder.lookup(inc.location, cache_only=geocoder.lookups >= live_lookups)
            if entry:
                inc.lat, inc.lon = entry["lat"], entry["lon"]
                inc.location_corrected = entry.get("corrected")
    tags = await geofences_for_points(pool, [(i.lat, i.lon) for i in incidents])
    for inc, names in zip(incidents, tags):
        inc.geofences = names
    return incidents, len(rows)


class RadioIncidentPoller(BasePoller):
    name = "radio_incidents"
    interval = 60

    def __init__(self):
        self._last_hash = ""

    async def setup(self):
        if settings.geocoder_url:
            # Street gazetteer for fuzzy geocoding; refreshes monthly, loads in
            # the background so a slow Overpass never delays the poll loop.
            asyncio.create_task(self._refresh_streets())

    async def _refresh_streets(self):
        from street_names import refresh_if_stale
        try:
            await refresh_if_stale(get_pool())
        except Exception as exc:
            logger.warning("[radio_incidents] street-name gazetteer refresh failed: %s", exc)

    async def poll(self):
        now = datetime.now(timezone.utc)
        window = settings.radio_incidents_window_hours
        geocoder = Geocoder(await get_bus(), get_pool())
        try:
            incidents, n_calls = await load_incidents(get_pool(), now - timedelta(hours=window),
                                                      geocoder, live_lookups=_LIVE_LOOKUPS_PER_CYCLE)
        except Exception as exc:
            # p25_recordings is created by the backend; absent on radio-less installs.
            logger.debug("[radio_incidents] transcript query failed: %s", exc)
            return

        published = [i.to_dict() for n, i in enumerate(incidents) if n < _MAX_PUBLISHED or i.lat is not None]
        body = {
            "window_hours": window,
            "transcribed_calls": n_calls,
            "incident_count": len(incidents),
            "located_count": sum(1 for i in incidents if i.lat is not None),
            "by_category": dict(Counter(i.category for i in incidents).most_common()),
            "incidents": published,
        }
        digest = hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
        if digest == self._last_hash:
            await touch_feed("radio:incidents")
            return
        self._last_hash = digest
        await set_feed("radio:incidents", {"ts": now.isoformat(), **body})
        located = sum(1 for i in incidents if i.lat is not None)
        logger.info("[radio_incidents] %d incidents from %d calls, %d located (%d new lookups) — %s",
                    len(incidents), n_calls, located, geocoder.lookups,
                    ", ".join(f"{k} {v}" for k, v in list(body["by_category"].items())[:5]))
