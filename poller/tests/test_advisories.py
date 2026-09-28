"""Advisory bar promotion rules."""
from datetime import datetime, timedelta, timezone

import advisories as adv

NOW = datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc)
HOME = (45.3842, -122.7635)
NEAR = (45.39, -122.77)      # < 1 km
FAR = (45.52, -122.68)       # ~16 km


def _inc(sev, cat="structure_fire", where=NEAR, minutes=10, units=2, calls=2, status="active", zones=None, iid="x"):
    return {"id": iid, "category": cat, "severity": sev, "location": "5450 SW Erickson Ave",
            "last_seen": (NOW - timedelta(minutes=minutes)).isoformat(), "status": status,
            "units": [f"E{i}" for i in range(units)], "call_count": calls,
            "lat": where[0] if where else None, "lon": where[1] if where else None, "geofences": zones or []}


def _radio(incs):
    return adv.from_radio(incs, NOW, HOME, 8.0, timedelta(minutes=60))


def test_nearby_structure_fire_is_red_and_opens_the_incident():
    [a] = _radio([_inc(5)])
    assert a["level"] == "red" and a["title"].startswith("Structure fire · ")
    assert a["target"] == {"tab": "incidents", "incident": "x"}


def test_radio_needs_near_recent_located_and_significant():
    assert _radio([_inc(5, where=FAR)]) == []                    # too far
    assert _radio([_inc(5, minutes=90)]) == []                   # too old
    assert _radio([_inc(5, where=None)]) == []                   # no pin
    assert _radio([_inc(5, status="cleared")]) == []
    assert _radio([_inc(3, cat="crash", where=(45.43, -122.70))]) == []   # routine, ~6 km
    assert _radio([_inc(1, cat="medical", units=5, calls=9)]) == []


def test_zone_extends_near_but_not_indefinitely():
    assert len(_radio([_inc(5, where=(45.45, -122.70), zones=["West Linn (area)"])])) == 1   # ~8.2 km
    assert _radio([_inc(5, where=(45.53, -122.54), zones=["Portland (area)"])]) == []         # ~23 km


def test_close_or_zoned_notable_incidents_are_amber():
    assert _radio([_inc(3, cat="fire", units=1)])[0]["why"] == "incident close to home"
    assert _radio([_inc(3, cat="assault", where=(45.43, -122.70), zones=["Home"])])[0]["level"] == "amber"


def test_hazards_and_multi_unit_responses_are_amber():
    assert _radio([_inc(4, cat="gas_leak")])[0]["level"] == "amber"
    assert _radio([_inc(3, cat="crash", units=3)])[0]["level"] == "amber"
    assert _radio([_inc(5, status="contained")])[0]["level"] == "amber"


def test_nws_severity_sets_level_and_expired_alerts_drop():
    red, amber = adv.from_nws([{"event": "Flash Flood Warning", "severity": "Severe", "headline": "h1"},
                               {"event": "Wind Advisory", "severity": "Moderate", "headline": "h2"}], NOW)
    assert (red["level"], amber["level"]) == ("red", "amber")
    assert adv.from_nws([{"event": "x", "severity": "Severe", "expires": (NOW - timedelta(hours=1)).isoformat()}], NOW) == []


def test_only_recent_nearby_closures():
    base = {"title": "Crash", "location": "OR99W", "severity": "Closure", "dist_km": 3,
            "pubDate": (NOW - timedelta(hours=1)).isoformat()}
    assert len(adv.from_traffic([base], NOW, 8.0, timedelta(hours=24))) == 1
    assert adv.from_traffic([{**base, "severity": "No to Minimum Delay"}], NOW, 8.0, timedelta(hours=24)) == []
    assert adv.from_traffic([{**base, "dist_km": 30}], NOW, 8.0, timedelta(hours=24)) == []
    assert adv.from_traffic([{**base, "pubDate": "2025-06-08T06:59:32-07:00"}], NOW, 8.0, timedelta(hours=24)) == []


def test_flashalert_only_for_local_places():
    items = [{"source": "flashalert", "title": "ODOT: PDX, Mt. Hood: Transportation", "summary": ""},
             {"source": "flashalert", "title": "Tigard-Tualatin School District: Schools", "summary": "Closed"},
             {"source": "nws_cap", "title": "Tualatin flood", "summary": ""}]
    out = adv.from_flashalert(items, ["Tualatin", "Tigard"])
    assert [a["title"] for a in out] == ["Tigard-Tualatin School District: Schools"]


def test_briefing_item_only_when_elevated_recent_and_never_red():
    text = "**BOTTOM LINE:** Posture ELEVATED. A structure fire at 1909 Main St persists.\n\n### Changes"
    [b] = adv.from_briefing({"posture": "ELEVATED", "ts": NOW.isoformat(), "summary": text}, NOW)
    assert b["level"] == "amber" and b["detail"] == "A structure fire at 1909 Main St persists."
    assert adv.from_briefing({"posture": "HIGH", "ts": NOW.isoformat(), "summary": text}, NOW)[0]["level"] == "amber"
    assert adv.from_briefing({"posture": "NORMAL", "ts": NOW.isoformat(), "summary": text}, NOW) == []
    assert adv.from_briefing({"posture": "ELEVATED", "ts": (NOW - timedelta(hours=3)).isoformat(), "summary": text}, NOW) == []


def test_rank_orders_by_level_then_score_and_sets_bar_level():
    ranked = adv.rank(_radio([_inc(4, cat="gas_leak", iid="a"), _inc(5, iid="b")])
                      + adv.from_flashalert([{"source": "flashalert", "title": "Tigard: x"}], ["Tigard"]))
    assert ranked["level"] == "red" and ranked["items"][0]["id"] == "radio:b" and ranked["count"] == 3
    assert adv.rank([]) == {"level": "green", "count": 0, "items": []}


def test_enriched_incident_reads_naturally_and_markers_escalate():
    inc = {**_inc(5), "nature": "Commercial fire", "city": "Oregon City",
           "unit_summary": "2 engines, a heavy rescue", "markers": ["Fire marshal"]}
    [a] = _radio([inc])
    assert a["title"] == "Commercial fire · 5450 SW Erickson Ave, Oregon City"
    assert a["detail"].startswith("Fire marshal · 2 engines, a heavy rescue")
    trapped = {**_inc(3, cat="crash", where=(45.43, -122.70)), "markers": ["Entrapment"]}   # ~7 km, routine otherwise
    assert _radio([trapped])[0]["level"] == "red"
    evac = {**_inc(3, cat="fire", where=(45.43, -122.70), units=1, calls=1), "markers": ["Evacuation"]}
    assert _radio([evac])[0]["level"] == "amber"
