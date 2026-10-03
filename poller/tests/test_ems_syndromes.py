"""Tests for hospital patient-report syndrome counting and surge detection.

Fixtures are short, invented phrasings in the style of medics' pre-arrival radio reports (no real patients).

Run from poller/:
    pytest tests/test_ems_syndromes.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import pytest

from ems_syndromes import TOTAL, classify_report, hourly_counts, merge_reports, surge_report

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
HOSP = lambda tag: "HOSP" in (tag or "")


@pytest.mark.parametrize("text, expected", [
    ("code 3 with a stroke alert 77 year old female last known normal two hours ago", {"stroke", "alert"}),
    ("he is bfast positive with facial droop", {"stroke"}),
    ("chest pain radiating to the left arm, sinus on the monitor", {"cardiac"}),
    ("patient was involved in a motor vehicle accident about fifteen minutes ago", {"trauma"}),
    ("ground level fall at the facility, no head strike", {"fall"}),
    ("intoxicated found by his partner, narcan given with improvement", {"tox"}),
    ("suicidal ideation with a plan, history of bipolar", {"psych"}),
    ("shortness of breath and wheezing, history of copd", {"respiratory"}),
    ("fever and a possible uti, probably sepsis", {"infection"}),
    ("heat exhaustion after working outside, dehydrated", {"heat_cold"}),
    ("witnessed seizure at work lasting four minutes", {"seizure"}),
    ("she is 14 weeks pregnant with cramping", {"obstetric"}),
])
def test_syndromes_are_recognised(text, expected):
    assert expected <= classify_report(text)


@pytest.mark.parametrize("text, key", [
    ("we are stroke negative with stable vitals", "stroke"),
    ("sepsis negative, just fluids", "infection"),
    ("no chest pain, no shortness of breath", "cardiac"),
    ("does not endorse shortness of breath", "respiratory"),
    ("no history of seizures", "seizure"),
    ("history of stroke two years ago", "stroke"),
    ("she feels like she will fall", "fall"),
    ("100 mcg of fentanyl on board, 4 of zofran", "tox"),
    ("hello, this is medic 5, we did hold the line", "psych"),
    ("mild labored breathing", "obstetric"),
])
def test_negated_historical_or_unrelated_mentions_do_not_count(text, key):
    assert key not in classify_report(text)


def test_calls_close_together_on_one_channel_are_one_report():
    rows = [(T0, 1, "PROV HOSP", "code one with a 60 year old male chest pain"),
            (T0 + timedelta(seconds=40), 1, "PROV HOSP", "vitals are stable, any questions"),
            (T0 + timedelta(seconds=60), 1, "OTHER HOSP", "a different hospital, another patient with a fall"),
            (T0 + timedelta(minutes=10), 1, "PROV HOSP", "a second patient with a fall"),
            (T0, 1, "WC Fire Disp", "engine 1 respond to a structure fire")]
    reports = merge_reports(rows, HOSP)
    assert [(r.tag, r.calls) for r in reports] == [("OTHER HOSP", 1), ("PROV HOSP", 2), ("PROV HOSP", 1)]


def test_hourly_counts_include_a_total_row_per_active_hour():
    rows = [(T0, 1, "A HOSP", "chest pain and a fall"), (T0 + timedelta(minutes=30), 1, "B HOSP", "a fall"),
            (T0 + timedelta(hours=2), 1, "A HOSP", "nothing notable here at all, routine transfer")]
    c = hourly_counts(merge_reports(rows, HOSP))
    h0 = T0.replace(minute=0)
    assert c[(h0, TOTAL)] == 2 and c[(h0, "fall")] == 2 and c[(h0, "cardiac")] == 1
    assert (h0 + timedelta(hours=2), TOTAL) in c and (h0 + timedelta(hours=1), TOTAL) not in c


# ── Surge detection ──────────────────────────────────────────────────────────

NOW = datetime(2026, 10, 10, 15, 30, tzinfo=timezone.utc)


def history(days: int, per_hour_total: int = 5, per_hour_tox=lambda d, h: 1 if h % 3 == 0 else 0, skip=()):
    """Steady synthetic traffic for `days` full days before NOW (plus today), with a little overdose activity."""
    c = {}
    end = NOW.replace(minute=0, second=0, microsecond=0)
    for i in range(days * 24 + 24):
        h = end - timedelta(hours=i)
        if (NOW - h).days in skip:
            continue
        c[(h, TOTAL)] = per_hour_total
        n = per_hour_tox((NOW - h).days, h.hour)
        if n:
            c[(h, "tox")] = n
    return c


def test_no_surge_verdict_until_enough_baseline_days_exist():
    r = surge_report(history(3), NOW)
    assert r["building"] and r["flags"] == [] and r["baseline_days"] < 5


def test_steady_traffic_raises_no_flags():
    r = surge_report(history(10), NOW)
    assert not r["building"] and r["flags"] == [] and r["reports_baseline"] == 120


def test_a_real_overdose_cluster_is_flagged_in_both_windows():
    c = history(10)
    end = NOW.replace(minute=0, second=0, microsecond=0)
    for i in range(5):                       # 3 extra overdoses an hour for five hours
        c[(end - timedelta(hours=i), "tox")] = c.get((end - timedelta(hours=i), "tox"), 0) + 3
    r = surge_report(c, NOW)
    row = next(s for s in r["syndromes"] if s["key"] == "tox")
    assert "tox" in r["flags"] and row["flag"] and row["count"] > row["baseline"] and row["count_6h"] > row["baseline_6h"]


def test_a_small_bump_is_not_a_surge():
    c = history(10)
    end = NOW.replace(minute=0, second=0, microsecond=0)
    c[(end, "tox")] = c.get((end, "tox"), 0) + 2
    assert surge_report(c, NOW)["flags"] == []


def test_days_with_missing_data_are_left_out_of_the_baseline():
    r = surge_report(history(10, skip=(2, 3, 4, 5, 6)), NOW)
    assert r["baseline_days"] <= 5
    full = surge_report(history(10), NOW)
    assert full["baseline_days"] > r["baseline_days"]
