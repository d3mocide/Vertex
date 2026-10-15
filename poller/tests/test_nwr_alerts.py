"""Tocsin (NOAA Weather Radio) alert mapping: SAME codes to zones, severity, relevance, merge with CAP."""
from datetime import datetime, timedelta, timezone

from nwr_alerts import recent_spoken, build_areas, fips_to_ugc, is_relevant, merge, normalize, outline_ugcs, round_geometry, zone_set

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
