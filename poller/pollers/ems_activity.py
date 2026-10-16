"""
EMS patient-report activity — hourly syndrome counts from hospital talkgroups plus surge detection.

Reads the transcripts the recorder already stores, merges them into patient reports, keeps only per-hour counts in
`ems_syndrome_hourly` (created here, like the ACARS and weather tables) so baselines outlive transcript retention,
and publishes the 24 h / 6 h comparison with the baseline to the `ems:activity` feed. The AI briefing reads that feed
and mentions a syndrome only when it is unusually high. See ems_syndromes.py for definitions and the method.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from bus import set_feed
from config import settings
from db import get_pool
from ems_syndromes import (ensure_table, load_counts, purge_old, refresh_counts, surge_report)
from radio_incidents import is_hospital_tag, patient_report_tags
from .base import BasePoller

logger = logging.getLogger(__name__)

_REFRESH_HOURS = 6          # transcripts arrive minutes late, so recent hours are recomputed every cycle
_BASELINE_DAYS = 14
_BACKFILL_DAYS = 45         # first cycle after a start recounts everything the recorder still holds
_PURGE_EVERY_S = 6 * 3600


class EmsActivityPoller(BasePoller):
    name = "ems_activity"
    interval = 300

    def __init__(self):
        self._ready = False
        self._backfilled = False
        self._last_purge = 0.0
        self._content_tags: set[str] = set()      # talkgroups whose traffic is mostly patient reports, whatever they are called

    def _is_hospital(self, tag) -> bool:
        extra = tuple(t.strip() for t in settings.radio_hospital_tags.split(",") if t.strip())
        return is_hospital_tag(tag, extra) or tag in self._content_tags

    async def _refresh_content_tags(self, pool, now) -> None:
        rows = await pool.fetch(
            "SELECT started_at, tgid, tag, transcription FROM p25_recordings "
            "WHERE started_at >= $1 AND length(coalesce(transcription, '')) >= 20", now - timedelta(hours=48))
        self._content_tags = patient_report_tags([tuple(r) for r in rows])

    async def poll(self):
        pool = get_pool()
        now = datetime.now(timezone.utc)
        try:
            if not self._ready:
                await ensure_table(pool)
                self._ready = True
            await self._refresh_content_tags(pool, now)
            since = now - timedelta(days=_BACKFILL_DAYS if not self._backfilled else 0, hours=_REFRESH_HOURS)
            n = await refresh_counts(pool, self._is_hospital, since)
            self._backfilled = True
            counts = await load_counts(pool, now - timedelta(days=_BASELINE_DAYS + 2))
        except Exception as exc:
            # p25_recordings is created by the backend; absent on radio-less installs.
            logger.debug("[ems] activity refresh failed: %s", exc)
            return
        if not counts:
            return
        report = surge_report(counts, now, baseline_days=_BASELINE_DAYS)
        await set_feed("ems:activity", report, broadcast=False)
        if time.time() - self._last_purge > _PURGE_EVERY_S:
            self._last_purge = time.time()
            try:
                await purge_old(pool)
            except Exception as exc:
                logger.debug("[ems] purge failed: %s", exc)
        flagged = ", ".join(report["flags"]) or "none"
        logger.info("[ems] %d patient reports in 24h (baseline %s over %d days%s) — surges: %s",
                    report["reports"], report["reports_baseline"], report["baseline_days"],
                    ", still building" if report["building"] else "", flagged)
