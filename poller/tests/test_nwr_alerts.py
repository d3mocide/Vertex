"""Tocsin (NOAA Weather Radio) alert mapping: SAME codes to zones, severity, relevance, merge with CAP."""
from datetime import datetime, timedelta, timezone

from nwr_alerts import LeadTracker, describe_area, event_severity, recent_spoken, build_areas, fips_to_ugc, is_relevant, merge, normalize, outline_ugcs, round_geometry, zone_set

NOW = datetime(2026, 10, 14, 18, 10, tzinfo=timezone.utc)


def _alert(code="TOR", name="Tornado Warning", tier="A", fips=("041067",), state="RF_ONLY", minutes_ago=2, purge=30):
    received = (NOW - timedelta(minutes=minutes_ago)).isoformat()
    return {
        "id": "abc", "state": state, "event_name": name, "fips_codes": list(fips), "first_seen": received,
        "sources": [{"kind": "RF", "event": {
            "tier": tier, "channel": "WX7", "callsign": "KPQR/NWS", "event_code": code, "event_name": name,
            "fips_codes": list(fips), "raw_header": "ZCZC-WXR-...", "received_at": received, "purge_minutes": purge}}],
    }


def test_fips_to_ugc_maps_county_and_rejects_statewide_or_malformed():
    assert fips_to_ugc("041067") == "ORC067"
    assert fips_to_ugc("053011") == "WAC011"
    assert fips_to_ugc("041000") is None      # whole state
    assert fips_to_ugc("99999") is None
    assert fips_to_ugc("") is None


def test_normalize_fields_and_severity_by_tier():
    out = normalize(_alert(), NOW)
    assert out["event"] == "Tornado Warning"
    assert out["severity"] == "Severe"
    assert out["source"] == "nwr" and out["nwr_state"] == "RF_ONLY"
    assert out["nwr_counties"] == ["ORC067"]
    assert out["expires"].startswith("2026-10-14T18:38")      # received 18:08 + 30 min
    assert "KPQR/NWS" in out["headline"] and not out["test"]
    assert normalize(_alert(tier="B"), NOW)["severity"] == "Moderate"
    assert normalize(_alert(tier="C"), NOW)["severity"] == "Minor"


def test_normalize_drops_expired_and_flags_tests():
    assert normalize(_alert(minutes_ago=40, purge=30), NOW) is None
    t = normalize(_alert(code="RWT", name="Required Weekly Test", tier="C", purge=15), NOW)
    assert t["test"] is True


def test_normalize_carries_transcript_text():
    assert normalize(_alert(), NOW, "  Take shelter now. ")["description"] == "Take shelter now."


def test_relevance_by_zone_filter():
    zones = zone_set("ORZ108, ORC067 ,WAC011")
    assert is_relevant(_alert(fips=("041067",)), zones)
    assert is_relevant(_alert(fips=("053011", "053015")), zones)
    assert not is_relevant(_alert(fips=("041005",)), zones)
    assert is_relevant(_alert(fips=("041000",)), zones)          # statewide covers the state
    assert not is_relevant(_alert(fips=("053000",)), zone_set("ORC067"))
    assert is_relevant(_alert(fips=("041005",)), set())          # no filter: show everything
    assert is_relevant(_alert(fips=()), zones)                   # no codes (keyword-only): kept


def test_relevance_with_only_forecast_zones_keeps_everything():
    # Forecast zones (ORZ108) cannot be compared to county codes, so they must not hide an alert.
    assert is_relevant(_alert(fips=("041005",)), zone_set("ORZ108,ORZ109"))


def test_merge_marks_cap_twin_instead_of_duplicating():
    cap = [{"event": "Tornado Warning", "headline": "NWS Portland issues...", "severity": "Extreme"}]
    nwr = [normalize(_alert(), NOW)]
    out = merge(cap, nwr)
    assert len(out) == 1 and out[0]["rf_heard"] is True


def test_merge_orders_new_before_old_and_tests_last_and_drops_stale_nwr():
    old = normalize(_alert(name="Flood Watch", tier="B", minutes_ago=20, purge=60), NOW)
    new = normalize(_alert(name="Severe Thunderstorm Warning", minutes_ago=1), NOW)
    test = normalize(_alert(code="RWT", name="Required Weekly Test", tier="C", minutes_ago=0, purge=15), NOW)
    stale_in_cap = [{"event": "Old", "source": "nwr"}, {"event": "Heat Advisory"}]
    out = merge(stale_in_cap, [test, old, new])
    assert [a["event"] for a in out] == ["Heat Advisory", "Severe Thunderstorm Warning", "Flood Watch", "Required Weekly Test"]


SQUARE = {"type": "Polygon", "coordinates": [[[-122.912345678, 45.1], [-122.8, 45.1], [-122.8, 45.2], [-122.912345678, 45.1]]]}


def test_outlines_only_for_rf_first_alerts_and_never_tests():
    rf = normalize(_alert(fips=("041067", "041051")), NOW)
    confirmed = normalize(_alert(name="Flood Warning", fips=("041005",), state="CONFIRMED"), NOW)
    test = normalize(_alert(code="RWT", name="Required Weekly Test", tier="C", fips=("041009",), purge=15), NOW)
    assert outline_ugcs([rf, confirmed, test]) == {"ORC067", "ORC051"}


def test_build_areas_pairs_alert_and_county_shape_and_skips_unknown_shapes():
    rf = normalize(_alert(fips=("041067", "041051")), NOW)
    areas = build_areas([rf], {"ORC067": SQUARE, "ORC051": None})
    assert [a["ugc"] for a in areas] == ["ORC067"]
    assert areas[0]["event"] == "Tornado Warning" and areas[0]["severity"] == "Severe"
    assert areas[0]["geometry"] == SQUARE and areas[0]["alert_id"] == "abc"


def test_round_geometry_trims_coordinates_but_keeps_structure():
    out = round_geometry(SQUARE)
    assert out["type"] == "Polygon" and out["coordinates"][0][0] == [-122.9123, 45.1]


def _chunk(ns, text="river levels", code="LIVE", passed=True, channel="WX7"):
    return {"timestamp_ns": ns, "text": text, "event_code": code, "passed_guard": passed, "channel": channel}


def test_recent_spoken_is_newest_first_whole_text_and_skips_alert_audio_and_failed_chunks():
    long_text = "word " * 120                                  # far longer than any display clamp
    chunks = [_chunk(3_000_000_000_000_000_000, "third"), _chunk(1_000_000_000_000_000_000, "first"),
              _chunk(2_000_000_000_000_000_000, long_text), _chunk(4_000_000_000_000_000_000, "alert", code="TOR"),
              _chunk(5_000_000_000_000_000_000, "garbled", passed=False), _chunk(6_000_000_000_000_000_000, "  ")]
    out = recent_spoken(chunks)
    assert [c["text"] for c in out] == ["third", long_text.strip(), "first"]
    assert out[0]["at"].startswith("2065") and out[0]["channel"] == "WX7"


def test_recent_spoken_respects_the_limit():
    assert len(recent_spoken([_chunk(i * 10**18, f"c{i}") for i in range(1, 30)], limit=5)) == 5


# ── county names, event severity, lead time ───────────────────────────────────────────────────────

COUNTIES = {"41005": {"county": "Clackamas", "state": "OR"}, "41051": {"county": "Multnomah", "state": "OR"},
            "41067": {"county": "Washington", "state": "OR"}, "53011": {"county": "Clark", "state": "WA"}}


def test_describe_area_groups_by_state_and_reads_like_a_sentence():
    assert describe_area(["041067", "041005", "041051", "053011"], COUNTIES) == \
        "Clackamas, Multnomah and Washington Counties (OR); Clark County (WA)"
    assert describe_area(["041005"], COUNTIES) == "Clackamas County (OR)"
    assert describe_area(["041067", "041067"], COUNTIES) == "Washington County (OR)"


def test_describe_area_survives_unknowns_statewide_codes_and_no_table():
    assert describe_area(["041999", "041000"], COUNTIES) == ""
    assert describe_area(["041067"], None) == "" and describe_area([], COUNTIES) == "" and describe_area(["12"], COUNTIES) == ""


def test_normalize_carries_area_tier_callsign_and_effective_time():
    out = normalize(_alert(fips=("041067", "041005")), NOW, counties=COUNTIES)
    assert out["area_desc"] == "Clackamas and Washington Counties (OR)"
    assert out["nwr_tier"] == "A" and out["nwr_callsign"] == "KPQR/NWS" and out["effective"] == out["received_at"]


def test_event_severity_follows_the_dispatch_tier():
    assert event_severity({"nwr_tier": "A"}) == "critical" and event_severity({"nwr_tier": "B"}) == "medium"
    assert event_severity({"nwr_tier": "C"}) == "low" and event_severity({}) == "low"


def _mapped(nid="a1", event="Tornado Warning", heard=1000.0, test=False):
    return {"nwr_id": nid, "event": event, "received_at": datetime.fromtimestamp(heard, timezone.utc).isoformat(), "test": test}


def test_the_radio_leads_when_the_cap_alert_shows_up_later():
    t = LeadTracker()
    assert t.update([_mapped(heard=1000)], set(), now=1010) == []                       # heard, no CAP yet
    got = t.update([_mapped(heard=1000)], {"tornado warning"}, now=1075)                # CAP appears 75 s after the radio
    assert got == [{"nwr_id": "a1", "event": "Tornado Warning", "lead_s": 75}]
    assert t.annotate(_mapped())["nwr_lead_s"] == 75
    assert t.update([_mapped(heard=1000)], {"tornado warning"}, now=1200) == []         # reported once


def test_when_the_nws_feed_already_had_it_the_radio_gets_no_credit():
    t = LeadTracker()
    assert t.update([_mapped(heard=1000)], {"tornado warning"}, now=1005) == []
    out = t.annotate(_mapped())
    assert out["nwr_cap_first"] is True and "nwr_lead_s" not in out


def test_an_alert_not_yet_confirmed_has_neither_flag_and_tests_are_ignored():
    t = LeadTracker()
    t.update([_mapped(), _mapped(nid="t1", event="Required Weekly Test", test=True)], set(), now=1010)
    assert t.annotate(_mapped()) == _mapped()
    assert "t1" not in t.items


def test_lead_tracker_round_trips_through_json_and_forgets_old_alerts():
    import json
    t = LeadTracker()
    t.update([_mapped(heard=1000)], set(), now=1010)
    t.update([_mapped(heard=1000)], {"tornado warning"}, now=1060)
    restored = LeadTracker(json.loads(json.dumps(t.state())))
    assert restored.annotate(_mapped())["nwr_lead_s"] == 60
    restored.update([], set(), now=1000 + 8 * 24 * 3600)
    assert restored.items == {}


def test_merge_puts_the_lead_on_the_cap_twin_too():
    rf = normalize(_alert(), NOW)
    rf["nwr_lead_s"] = 75
    cap = [{"event": "Tornado Warning", "headline": "x", "severity": "Extreme"}]
    assert merge(cap, [rf])[0]["nwr_lead_s"] == 75
