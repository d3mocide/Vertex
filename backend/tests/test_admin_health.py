"""Tests for the admin dashboards' health judgments.

Run from backend/:
    pytest tests/test_admin_health.py
"""
from __future__ import annotations

import os
import sys

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

import admin_health as h

NOW = 1_800_000_000.0
HOUR = 3600


def _purge(hours_ago):
    return {"ts": NOW - hours_ago * HOUR, "deleted": 100}


# ── storage ──────────────────────────────────────────────────────────────────
def test_a_pruning_database_at_the_retention_age_is_healthy():
    """The reported bug: oldest data exactly at retention age (30.0 d of 30 d) was flagged CRITICAL."""
    r = h.storage_health(30.0, 30, _purge(3), NOW)
    assert r["status"] == "ok" and "keeping up" in r["message"]


def test_slightly_past_retention_is_still_fine_between_daily_purges():
    assert h.storage_health(31.6, 30, _purge(20), NOW)["status"] == "ok"


def test_purge_behind_is_degraded_then_critical():
    assert h.storage_health(33.0, 30, _purge(5), NOW)["status"] == "degraded"
    crit = h.storage_health(40.0, 30, _purge(5), NOW)
    assert crit["status"] == "critical" and "not keeping up" in crit["message"]


def test_a_purge_that_stopped_running_is_flagged():
    r = h.storage_health(30.5, 30, _purge(72), NOW)
    assert r["status"] == "degraded" and "72 hours" in r["message"]


def test_no_recorded_purge_yet_is_not_an_alarm_when_data_is_within_retention():
    r = h.storage_health(29.0, 30, None, NOW)
    assert r["status"] == "ok" and r["last_purge_age_hours"] is None


def test_empty_table_is_healthy():
    assert h.storage_health(None, 30, None, NOW)["status"] == "ok"


def test_raising_retention_makes_old_data_normal():
    assert h.storage_health(45.0, 30, _purge(2), NOW)["status"] == "critical"
    assert h.storage_health(45.0, 60, _purge(2), NOW)["status"] == "ok"


def test_steady_state_estimate_scales_with_retention():
    e30 = h.steady_state_estimate(100_000, 30, 1_000_000_000, 2_000_000)
    e60 = h.steady_state_estimate(100_000, 60, 1_000_000_000, 2_000_000)
    assert e30["rows"] == 3_000_000 and e30["bytes"] == 1_500_000_000
    assert e60["bytes"] == 2 * e30["bytes"]
    assert h.steady_state_estimate(100_000, 30, 0, 0)["bytes"] == 0


# ── entity liveness ──────────────────────────────────────────────────────────
def test_continuous_feeds_are_live_by_their_newest_sighting():
    assert h.type_liveness("aircraft", 60) == {"continuous": True, "live": True, "live_window_min": 15}
    assert h.type_liveness("aircraft", 20 * 60)["live"] is False
    assert h.type_liveness("mesh_node", 40 * 60)["live"] is True       # mesh nodes advert less often
    assert h.type_liveness("stream_gauge", 30 * 60)["live"] is True
    assert h.type_liveness("train", None)["live"] is False


def test_event_driven_types_never_count_against_health():
    r = h.type_liveness("fire_incident", 8000 * 60)
    assert r["continuous"] is False and r["live"] is None
    assert h.type_liveness("something_new", 5)["continuous"] is False


# ── connection pool ──────────────────────────────────────────────────────────
def test_four_of_five_with_overflow_available_is_not_a_warning():
    """The reported case: pool 5, 4 checked out, up to 10 more available."""
    r = h.pool_status(5, 4, 10)
    assert r["level"] == "ok" and r["capacity"] == 15 and r["overflow_in_use"] == 0


def test_using_overflow_is_reported_but_not_alarming_by_itself():
    r = h.pool_status(5, 8, 10)
    assert r["level"] == "ok" and r["overflow_in_use"] == 3


def test_near_and_at_capacity_escalate():
    assert h.pool_status(5, 12, 10)["level"] == "warn"
    assert h.pool_status(5, 15, 10)["level"] == "critical"
    assert h.pool_status(0, 0, 0)["capacity"] == 1     # never divides by zero


# ── data sources ─────────────────────────────────────────────────────────────
def test_feed_status_is_relative_to_how_often_it_should_update():
    assert h.feed_row("traffic:incidents", 300, 600)["status"] == "ok"
    assert h.feed_row("traffic:incidents", 700, 600)["status"] == "stale"
    assert h.feed_row("traffic:incidents", 601 * 3, 600)["status"] == "down"


def test_change_driven_feeds_are_never_alarmed():
    r = h.feed_row("radio:active", 50_000, None)
    assert r["status"] == "on_change" and r["label"] == "Active radio call"


def test_unknown_feed_keys_still_show_by_key():
    r = h.feed_row("brand:new", 10, 100, items=7)
    assert r["label"] == "brand:new" and r["group"] == "Other" and r["items"] == 7


# ── what needs attention ─────────────────────────────────────────────────────
def _healthy():
    """The state of a healthy install: nothing should be flagged."""
    return {
        "postgres": {"ping_ms": 1.8}, "redis": {"ping_ms": 0.3},
        "pollers": [{"name": "adsb", "status": "ok", "staleness_s": 2}],
        "feeds": [h.feed_row("traffic:incidents", 60, 600), h.feed_row("radio:active", 9999, None)],
        "activity": [{"entity_type": "aircraft", "continuous": True, "live": True},
                     {"entity_type": "fire_incident", "continuous": False, "live": None}],
        "storage": {"status": "ok", "message": ""}, "pool": {"level": "ok"},
        "api": {"error_pct": 0.0, "p95_ms": 100}, "briefing_age_s": 1800,
        "receiver": {"beast_connected": True, "beast_healthy": True},
    }


def test_a_healthy_install_has_nothing_to_report():
    issues = h.build_issues(_healthy())
    assert issues == [] and h.overall_status(issues) == "ok"


def test_missing_inputs_are_skipped_not_errors():
    assert h.build_issues({}) == []


def test_each_failure_mode_is_reported_with_the_right_severity():
    s = _healthy()
    s["postgres"] = {"ping_ms": -1}
    s["pollers"] = [{"name": "traffic", "status": "error", "last_error": "HTTP 401", "staleness_s": 3},
                    {"name": "fire", "status": "stale", "staleness_s": 900}]
    s["feeds"] = [h.feed_row("traffic:incidents", 5000, 600), h.feed_row("news:local", 99999, 900)]
    s["activity"][0].update(live=False, newest_age_s=1800)
    s["storage"] = {"status": "critical", "message": "purge broken"}
    s["pool"] = {"level": "warn", "message": "busy"}
    s["api"] = {"error_pct": 3.0, "p95_ms": 100}
    s["briefing_age_s"] = 5 * 3600
    s["receiver"] = {"beast_connected": True, "beast_healthy": False, "last_frame_age_s": 400}
    issues = h.build_issues(s)
    by_area = {}
    for i in issues:
        by_area.setdefault(i["area"], []).append(i["severity"])
    assert by_area["database"] == ["critical", "warning"]           # postgres down, pool warning
    assert by_area["pollers"] == ["warning", "warning"]
    assert by_area["feeds"] == ["warning"] and by_area["storage"] == ["critical"]
    assert by_area["ingest"] == ["warning"] and by_area["api"] == ["warning"]
    assert by_area["briefing"] == ["warning"] and by_area["receiver"] == ["warning"]
    assert h.overall_status(issues) == "critical"
    sev = [i["severity"] for i in issues]
    assert sev == sorted(sev, key=lambda x: {"critical": 0, "warning": 1, "info": 2}[x])   # most severe first


def test_late_feeds_are_grouped_into_one_issue():
    s = _healthy()
    s["feeds"] = [h.feed_row(k, 999_999, 600) for k in ("weather:alerts", "traffic:signs", "news:local", "fire:danger", "traffic:flow", "utility:outages", "hydro:status")]
    (issue,) = [i for i in h.build_issues(s) if i["area"] == "feeds"]
    assert "7 data feeds running late" == issue["title"] and "and 2 more" in issue["detail"]


def test_event_driven_types_and_change_only_feeds_never_raise_issues():
    s = _healthy()
    s["activity"] = [{"entity_type": "fire_incident", "continuous": False, "live": None, "newest_age_s": 500_000}]
    s["feeds"] = [h.feed_row("radio:active", 500_000, None)]
    assert h.build_issues(s) == []


def test_no_local_receiver_is_information_only():
    s = _healthy()
    s["receiver"] = {"beast_connected": False}
    issues = h.build_issues(s)
    assert [i["severity"] for i in issues] == ["info"] and h.overall_status(issues) == "ok"


def test_api_thresholds_match_the_old_banner():
    s = _healthy()
    s["api"] = {"error_pct": 1.0, "p95_ms": 600}
    assert [i["severity"] for i in h.build_issues(s)] == ["warning"]
    s["api"] = {"error_pct": 1.0, "p95_ms": 1500}
    assert [i["severity"] for i in h.build_issues(s)] == ["critical"]


# ── hourly series and dispatch ───────────────────────────────────────────────
from datetime import datetime, timedelta, timezone

NOW_DT = datetime(2026, 9, 30, 4, 20, tzinfo=timezone.utc)


def test_hourly_index_puts_the_current_hour_last_and_drops_anything_older_than_a_day():
    assert h.hourly_index(NOW_DT, NOW_DT) == 23
    assert h.hourly_index(NOW_DT - timedelta(minutes=10), NOW_DT) == 23          # 04:10, same clock hour
    assert h.hourly_index(NOW_DT - timedelta(minutes=30), NOW_DT) == 22          # 03:50 is the previous clock hour
    assert h.hourly_index(datetime(2026, 9, 30, 4, 0, tzinfo=timezone.utc), NOW_DT) == 23
    assert h.hourly_index(datetime(2026, 9, 30, 3, 59, tzinfo=timezone.utc), NOW_DT) == 22
    assert h.hourly_index(datetime(2026, 9, 29, 5, 0, tzinfo=timezone.utc), NOW_DT) == 0      # 23 clock hours back
    assert h.hourly_index(datetime(2026, 9, 29, 4, 59, tzinfo=timezone.utc), NOW_DT) is None  # 24 hours back
    assert h.hourly_index(NOW_DT + timedelta(hours=2), NOW_DT) is None


def test_hourly_index_handles_other_timezones():
    local = datetime(2026, 9, 29, 21, 10, tzinfo=timezone(timedelta(hours=-7)))       # 04:10 UTC
    assert h.hourly_index(local, NOW_DT) == 23


def test_hourly_counts_sums_into_slots():
    times = [NOW_DT, NOW_DT - timedelta(minutes=5), NOW_DT - timedelta(hours=2), NOW_DT - timedelta(days=3)]
    out = h.hourly_counts(times, NOW_DT)
    assert len(out) == 24 and out[23] == 2 and out[21] == 1 and sum(out) == 3      # 02:20 is two clock hours back


def test_pct():
    assert h.pct(1, 4) == 25.0 and h.pct(0, 5) == 0.0 and h.pct(0, 0) is None


def _inc(minutes_ago, sev=1, cat="medical", located=True, first_min=None):
    last = NOW_DT - timedelta(minutes=minutes_ago)
    first = NOW_DT - timedelta(minutes=first_min if first_min is not None else minutes_ago)
    return {"last_seen": last.isoformat(), "first_seen": first.isoformat(), "severity": sev, "category": cat,
            "lat": 45.4 if located else None, "lon": -122.7 if located else None, "status": "active"}


def test_dispatch_activity_summarizes_incidents():
    incs = [_inc(10, sev=5, cat="structure_fire"), _inc(30), _inc(200, located=False), _inc(90, cat="crash", located=False)]
    d = h.dispatch_activity(incs, NOW_DT)
    assert d["seen_24h"] == 4 and d["active_now"] == 2            # heard within the last 60 minutes
    assert d["located"] == 2 and d["located_pct"] == 50.0 and d["life_safety"] == 1
    assert d["categories"][0] == ["medical", 2] and sum(v for _, v in d["categories"]) == 4
    assert d["newest_age_s"] == 600 and sum(d["hourly"]) == 4


def test_dispatch_activity_uses_last_heard_not_the_stale_status_field():
    """The feed leaves most incidents "active"; an incident last heard hours ago must not count as active now."""
    d = h.dispatch_activity([_inc(300)], NOW_DT)
    assert d["active_now"] == 0


def test_dispatch_activity_with_nothing_is_all_zero_and_safe():
    d = h.dispatch_activity([], NOW_DT)
    assert d["seen_24h"] == 0 and d["located_pct"] is None and d["newest_age_s"] is None and d["hourly"] == [0] * 24


def test_dispatch_activity_tolerates_missing_and_bad_fields():
    d = h.dispatch_activity([{"severity": None, "last_seen": "garbage"}, {}], NOW_DT)
    assert d["seen_24h"] == 2 and d["active_now"] == 0
