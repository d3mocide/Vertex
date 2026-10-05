"""How busy dispatch is compared with the same hours on earlier days.

The Incidents page shows each category's count for the last 24 h next to what is usual. The comparison is the same
24-hour window on each of the previous days (so day and night patterns cancel out), judged with the same
median / MAD rule the EMS surge counter uses. Only incidents of severity 3 or more count: routine chatter would
drown the signal. Pure functions; the poller feeds them incidents extracted over the whole baseline period.
"""
from __future__ import annotations

import statistics
from collections import Counter
from datetime import datetime, timedelta

from ems_syndromes import _expected

MIN_SEVERITY = 3
TOTAL = "total"


def _window_counts(incidents, start: datetime, end: datetime) -> Counter:
    c: Counter = Counter()
    for i in incidents:
        if i.severity >= MIN_SEVERITY and start <= i.first_seen < end:
            c[i.category] += 1
            c[TOTAL] += 1
    return c


def baseline_report(incidents, now: datetime, earliest: datetime | None, *, baseline_days: int = 14,
                    min_baseline_days: int = 5, z: float = 3.0, min_count: int = 4) -> dict:
    """Per-category count over the last 24 h, the usual count, and a flag when it is unusually high.

    `earliest` is when transcripts begin; days that start before it are not counted as quiet days, they are missing.
    `building` stays true until `min_baseline_days` whole earlier days exist.
    """
    end = now.replace(minute=0, second=0, microsecond=0)
    day = timedelta(days=1)
    current = _window_counts(incidents, end - day, end)
    history = []
    for d in range(1, baseline_days + 1):
        s, e = end - day - d * day, end - d * day
        if earliest is not None and s >= earliest:
            history.append(_window_counts(incidents, s, e))
    out: dict = {"ts": now.isoformat(), "window_hours": 24, "baseline_days": len(history),
                 "building": len(history) < min_baseline_days, "categories": {}, "flags": []}
    for cat in sorted(set(current) | {k for h in history for k in h}):
        row = {"count": current.get(cat, 0), "usual": None, "flag": False}
        if not out["building"]:
            vals = [h.get(cat, 0) for h in history]
            med, sigma = _expected(vals)
            row["usual"] = round(med, 1)
            row["flag"] = row["count"] >= min_count and row["count"] >= med + z * sigma
        out["categories"][cat] = row
        if row["flag"] and cat != TOTAL:
            out["flags"].append(cat)
    return out
