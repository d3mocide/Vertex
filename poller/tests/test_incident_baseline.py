"""Tests for the dispatch-volume baseline (incident_baseline.py)."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from incident_baseline import baseline_report
from radio_incidents import Incident

NOW = datetime(2026, 10, 5, 15, 30, tzinfo=timezone.utc)
END = NOW.replace(minute=0)


def _inc(ts, cat="crash", sev=3):
    return Incident(category=cat, severity=sev, location=None, key=None, first_seen=ts, last_seen=ts)


def _history(per_day, days=8, cat="crash"):
    return [_inc(END - timedelta(days=d, hours=3, minutes=k), cat) for d in range(1, days + 1) for k in range(per_day)]


EARLIEST = NOW - timedelta(days=20)


def test_building_until_enough_days_exist():
    r = baseline_report(_history(2, days=3), NOW, NOW - timedelta(days=3, hours=-1))
    assert r["building"] and r["categories"]["crash"]["usual"] is None and not r["flags"]


def test_unusually_busy_category_is_flagged_and_normal_one_is_not():
    inc = _history(3) + [_inc(END - timedelta(hours=2, minutes=k)) for k in range(12)]
    inc += [_inc(END - timedelta(hours=2, minutes=k), "fire") for k in range(3)] + _history(3, cat="fire")
    r = baseline_report(inc, NOW, EARLIEST)
    assert not r["building"] and r["baseline_days"] >= 5
    assert r["categories"]["crash"]["flag"] and r["categories"]["crash"]["usual"] == 3.0
    assert not r["categories"]["fire"]["flag"] and "fire" not in r["flags"]


def test_routine_incidents_and_days_before_the_feed_started_do_not_count():
    inc = _history(3) + [_inc(END - timedelta(hours=1), "medical", sev=1)]
    r = baseline_report(inc, NOW, END - timedelta(days=5))   # only 4 full earlier days of data
    assert "medical" not in r["categories"] and r["building"] and r["baseline_days"] == 4
