"""
Radio incident feed — structured incidents extracted from P25 dispatch transcripts.

Every minute, re-extract incidents from the last N hours of transcribed
calls (see radio_incidents.py), tag any located ones with geofences, and
publish `feed:radio:incidents` for the UI and the AI briefing. The feed is
only republished when its content changes.
"""
import hashlib
import json
import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from bus import set_feed
from config import settings
from db import get_pool
from geo_tags import geofences_for_points
from radio_incidents import extract
from .base import BasePoller

logger = logging.getLogger(__name__)

# Most significant incidents published; the rest are only counted.
_MAX_PUBLISHED = 150


async def load_incidents(pool, since: datetime):
    """Extract ranked incidents from transcripts recorded since `since`."""
    rows = await pool.fetch(
        "SELECT started_at, tgid, tag, transcription FROM p25_recordings "
        "WHERE started_at >= $1 AND length(coalesce(transcription, '')) >= 20 "
        "ORDER BY started_at",
        since,
    )
    incidents = extract([tuple(r) for r in rows])
    tags = await geofences_for_points(pool, [(i.lat, i.lon) for i in incidents])
    for inc, names in zip(incidents, tags):
        inc.geofences = names
    return incidents, len(rows)


class RadioIncidentPoller(BasePoller):
    name = "radio_incidents"
    interval = 60

    def __init__(self):
        self._last_hash = ""

    async def poll(self):
        now = datetime.now(timezone.utc)
        window = settings.radio_incidents_window_hours
        try:
            incidents, n_calls = await load_incidents(get_pool(), now - timedelta(hours=window))
        except Exception as exc:
            # p25_recordings is created by the backend; absent on radio-less installs.
            logger.debug("[radio_incidents] transcript query failed: %s", exc)
            return

        published = [i.to_dict() for i in incidents[:_MAX_PUBLISHED]]
        body = {
            "window_hours": window,
            "transcribed_calls": n_calls,
            "incident_count": len(incidents),
            "by_category": dict(Counter(i.category for i in incidents).most_common()),
            "incidents": published,
        }
        digest = hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()
        if digest == self._last_hash:
            return
        self._last_hash = digest
        await set_feed("radio:incidents", {"ts": now.isoformat(), **body})
        logger.info("[radio_incidents] %d incidents from %d calls (%s)", len(incidents), n_calls,
                    ", ".join(f"{k} {v}" for k, v in list(body["by_category"].items())[:5]))
