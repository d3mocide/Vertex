"""NOAA Weather Radio broadcast parsing, against real Tocsin transcripts (two 20-minute windows of the Portland
station) and synthetic edge cases. The fixture is the speech-to-text output as it came, garbles included."""
import json
from pathlib import Path

import pytest

import nwr_broadcast as nb

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "nwr_pqr_broadcast.json").read_text())
LOOP, RIVERS = FIXTURE["loop"], FIXTURE["rivers"]
OFFICE = nb.Office("PQR")


def chunks(*texts, step_s=20):
    return [{"timestamp_ns": int((1_000_000 + i * step_s) * 1e9), "text": t} for i, t in enumerate(texts)]


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────

def test_digitize_turns_number_words_into_digits():
    assert nb.digitize("wind north at six knots") == "wind north at 6 knots"
    assert nb.digitize("twenty five and thirty-two and seventeen") == "25 and 32 and 17"
    assert nb.digitize("someone, none, bone, stone") == "someone, none, bone, stone"       # only whole words


def test_stitch_joins_in_time_order_and_breaks_on_a_dropout():
    c = [{"timestamp_ns": 40e9, "text": "world"}, {"timestamp_ns": 20e9, "text": "hello"},
         {"timestamp_ns": 200e9, "text": "after a gap"}]
    assert nb.stitch(c) == "hello world\nafter a gap"
    assert nb.stitch([]) == ""
    assert nb.stitch([{"timestamp_ns": 1e9, "text": ""}]) == ""


@pytest.mark.parametrize("spoken,city", [
    ("Skatoos", "Scappoose"), ("Core Vallis", "Corvallis"), ("Historia", "Astoria"), ("Testoria", "Astoria"),
    ("Kilsborough", "Hillsboro"), ("Trowddale", "Troutdale"), ("Redman", "Redmond"), ("Roosevelt", "Roseburg"),
    ("and falling Pendleton", "Pendleton"), ("Portland partly", "Portland"), ("The Dalles", "The Dalles"),
    ("Salam", "Salem"),                                   # not in the alias list: the fuzzy fallback
])
def test_garbled_city_names_resolve(spoken, city):
    assert OFFICE.city(spoken) == city


def test_an_unknown_place_is_none_not_a_guess():
    assert OFFICE.city("Springfield") is None and OFFICE.city("") is None and OFFICE.city("mostly") is None


@pytest.mark.parametrize("river,place,gauge", [
    ("North Stantiam", "Mojema", "North Santiam River at Mehama"),
    ("Clackamas", "Esta Cada", "Clackamas River at Estacada"),
    ("Clackamas", "Three Links", "Clackamas River at Three Lynx"),
    ("Upquar", "Elkden", "Umpqua River near Elkton"),
    ("South Umpquah", "Winchester", "North Umpqua River at Winchester"),   # the place decides, not the garbled "South"
    ("Wednesday On The Willamette", "Eugene", "Willamette River at Eugene"),
])
def test_garbled_gauges_resolve_by_place_first(river, place, gauge):
    assert nb.match_gauge(river, place, OFFICE)[0] == gauge


def test_an_unknown_gauge_is_not_forced_onto_a_known_one():
    assert nb.match_gauge("Columbia", "Vancouver", OFFICE)[0] is None


def test_a_hopeless_garble_is_dropped_rather_than_guessed():
    assert nb.match_gauge("UPCR", "Elkden", OFFICE)[0] is None


# ── a normal loop ─────────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def loop():
    return nb.parse(LOOP, "PQR")


def test_the_low_water_alert_is_found_with_its_wording_repaired(loop):
    assert [n["id"] for n in loop["notices"]] == ["low-water-alert"]
    n = loop["notices"][0]
    assert n["title"] == "Low Water Alert"
    assert "river stages below 1 foot during low tide for the columbia river and willamette river" in n["text"].lower()
    assert "Boaters should use caution" in n["text"] and "water.noaa.gov" in n["text"]
    assert n["heard"] >= 1


def test_observations_come_from_the_latest_block_in_broadcast_order(loop):
    obs = loop["observations"]
    assert obs["hour"] in {"4 PM", "5 PM"}
    places = [s["place"] for s in obs["stations"]]
    assert len(places) >= 12 and places == sorted(places, key=OFFICE.cities.index)
    portland = next(s for s in obs["stations"] if s["place"] == "Portland")
    assert 50 <= portland["temp_f"] <= 90 and portland["sky"] and portland["wind_mph"] is not None
    assert all(-40 <= s["temp_f"] <= 130 for s in obs["stations"])
    assert all(s["pressure_in"] is None or 28 <= s["pressure_in"] <= 32 for s in obs["stations"])


def test_the_buoy_report_and_the_bar_conditions(loop):
    assert loop["marine"]["buoy"] == {"name": "Columbia River buoy 29", "wind_dir": "S", "wind_kt": 2, "seas_ft": 5.0, "period_s": 14}
    assert loop["marine"]["bar"]["seas_ft"] == [4, 6] and "Thursday" in loop["marine"]["bar"]["note"]


def test_zone_forecasts_are_split_by_area(loop):
    areas = [f["area"] for f in loop["forecasts"]]
    assert "Greater Portland Metro Area" in areas and "North Oregon Coast" in areas
    portland = next(f for f in loop["forecasts"] if f["area"] == "Greater Portland Metro Area")
    assert portland["text"].lower().startswith(("this afternoon", "sunny", "tonight")) or "sunny" in portland["text"].lower()
    assert len(portland["text"]) <= 700


def test_a_window_without_a_river_report_has_no_rivers(loop):
    assert loop["rivers"] == []


# ── a loop with the river report ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def rivers():
    return {r["name"]: r for r in nb.parse(RIVERS, "PQR")["rivers"]}


def test_river_gauges_resolve_to_their_canonical_names_once_each(rivers):
    assert len(rivers) >= 13
    assert set(rivers) <= {g[0] for g in OFFICE.gauges}


def test_stage_and_flow_values_match_the_broadcast(rivers):
    salem = rivers["Willamette River at Salem"]
    assert (salem["stage_ft"], salem["flow_cfs"]) == (5.4, 7057)             # the flow belongs to the last gauge in the list
    assert rivers["Willamette River at Corvallis"]["stage_ft"] == 10.0 and rivers["Willamette River at Corvallis"]["flow_cfs"] is None
    assert (rivers["Clackamas River at Three Lynx"]["stage_ft"], rivers["Clackamas River at Three Lynx"]["flow_cfs"]) == (0.3, 593)
    assert rivers["McKenzie River near Vida"]["stage_ft"] == 0.9


def test_a_missing_report_is_marked_missing_not_zero(rivers):
    waterloo = rivers["South Santiam River at Waterloo"]
    assert waterloo["missing"] is True and waterloo["stage_ft"] is None and waterloo["flow_cfs"] is None


# ── edge cases ────────────────────────────────────────────────────────────────────────────────────

def test_nothing_in_nothing_out():
    out = nb.parse([], "PQR")
    assert out["notices"] == [] and out["rivers"] == [] and out["marine"] == {} and out["forecasts"] == []
    assert out["observations"] == {"hour": None, "stations": []}


def test_an_office_with_no_place_list_still_gets_notices_marine_and_forecasts():
    other = nb.parse(LOOP, "XXX")
    assert [n["id"] for n in other["notices"]] == ["low-water-alert"]
    assert other["marine"]["buoy"]["wind_kt"] == 2 and other["forecasts"]
    assert other["observations"]["stations"] == []                           # cities need the office's list


def test_a_broadcast_with_no_notice_has_none():
    text = ("The current time is 3.14 PM Pacific Daylight Time. Hourly weather observations at 3 p.m. "
            "Portland, sunny. Temperature 70. Wind west at 7. Pressure 30.26 inches and falling.")
    out = nb.parse(chunks(text), "PQR")
    assert out["notices"] == [] and out["observations"]["stations"][0]["place"] == "Portland"


def test_notice_wordings_across_loops_merge_into_one_notice_with_the_commonest_text():
    base = "The current time is {t} PM Pacific Daylight Time. Low water alert. Expect river stages below {n} foot during low tide. {v} should use caution in shallow areas. Hourly weather observations at 3 p.m."
    c = chunks(base.format(t="3.14", n="one", v="Voters"), "filler", base.format(t="3.26", n="1", v="Voters"),
               "filler", base.format(t="3.37", n="one", v="Boaters"))
    out = nb.parse(c, "PQR")["notices"]
    assert len(out) == 1 and out[0]["heard"] == 3 and "below 1 foot" in out[0]["text"] and "Boaters should use caution" in out[0]["text"]


def test_implausible_numbers_are_dropped():
    text = ("Hourly weather observations at 3 p.m. Portland, sunny. Temperature 900. Salem, sunny. Temperature 70. "
            "Wind north at 5. Pressure 99.99 inches and rising.")
    stations = nb.parse(chunks(text), "PQR")["observations"]["stations"]
    assert [s["place"] for s in stations] == ["Salem"] and stations[0]["pressure_in"] is None


def test_a_dropout_does_not_join_sentences_across_the_gap():
    c = [{"timestamp_ns": 0, "text": "Hourly weather observations at 3 p.m. Portland, sunny. Temperature"},
         {"timestamp_ns": 300e9, "text": "70. Wind west at 7."}]
    assert nb.parse(c, "PQR")["observations"]["stations"] == []             # "Temperature" and "70" were minutes apart


# ── notices over time ─────────────────────────────────────────────────────────────────────────────

def test_stitch_marked_dates_a_position_in_the_text():
    c = [{"timestamp_ns": 100e9, "text": "alpha beta"}, {"timestamp_ns": 120e9, "text": "gamma"}]
    text, marks = nb.stitch_marked(c)
    assert text == "alpha beta gamma"
    assert nb._time_at(marks, text.index("beta")) == 100 and nb._time_at(marks, text.index("gamma")) == 120


def test_each_loop_of_a_notice_carries_its_own_time(loop):
    n = loop["notices"][0]
    times = [lp["at"] for lp in n["loops"]]
    assert len(times) >= 2 and times == sorted(times) and all(t > 1e9 for t in times)


def _found(nid, *loops):
    return [{"id": nid, "loops": [{"text": t, "at": at} for t, at in loops]}]


GOOD = "Low water alert. Expect river stages below 1 foot. Boaters should use caution."
NOISY = "Low water alert. Expect river stages below 1 foot for the collision. Boaters should use caution."


def test_the_majority_wording_wins_even_when_the_latest_loop_is_noisy():
    book = nb.NoticeBook()
    book.update(_found("low-water-alert", (GOOD, 1000), (GOOD, 1700), (NOISY, 2400)), now=2500)
    only = book.current(2500)[0]
    assert only["text"] == GOOD and only["title"] == "Low Water Alert" and only["heard"] == 3 and only["active"]


def test_a_loop_is_counted_once_however_often_it_is_reparsed():
    book = nb.NoticeBook()
    for _ in range(5):
        book.update(_found("x", (NOISY, 1000)), now=1100)
    assert book.current(1100)[0]["heard"] == 1


def test_a_notice_goes_inactive_when_it_leaves_the_air_and_is_forgotten_after_a_day():
    book = nb.NoticeBook()
    book.update(_found("x", (GOOD, 1000)), now=1100)
    assert book.current(1100 + 40 * 60)[0]["active"] is True
    assert book.current(1100 + 60 * 60)[0]["active"] is False
    book.update([], now=1000 + 25 * 3600)
    assert book.current(1000 + 25 * 3600) == []


def test_first_and_last_heard_and_a_json_round_trip():
    import json
    book = nb.NoticeBook()
    book.update(_found("x", (GOOD, 1000), (GOOD, 2000)), now=2100)
    restored = nb.NoticeBook(json.loads(json.dumps(book.state())))
    n = restored.current(2100)[0]
    assert n["first_seen"].startswith("1970-01-01T00:16:40") and n["last_seen"].startswith("1970-01-01T00:33:20")
    restored.update(_found("x", (GOOD, 2000)), now=2100)                    # already counted before the "restart"
    assert restored.current(2100)[0]["heard"] == 2


def test_active_notices_sort_before_old_ones():
    book = nb.NoticeBook()
    book.update(_found("old", (GOOD, 100)), now=100)
    book.update(_found("new", (GOOD, 9000)), now=9000)
    assert [n["id"] for n in book.current(9000)] == ["new", "old"]


# ── radio vs the official reading ─────────────────────────────────────────────────────────────────

NOW = 1_000_000.0


def _official(stage, flow=None, age=600):
    return {"stage_ft": stage, "flow_cfs": flow, "at": NOW - age}


def test_gauges_carry_their_official_ids(rivers):
    assert rivers["Willamette River at Salem"]["lid"] == "SLMO3"
    assert rivers["North Umpqua River at Winchester"]["lid"] == "WNRO3"
    assert all(r["lid"] for r in rivers.values())


def test_agreeing_readings_match_and_small_flow_rounding_is_fine():
    radio = {"stage_ft": 5.4, "flow_cfs": 7057, "missing": False}
    out = nb.compare_river(radio, _official(5.36, 7060), NOW)
    assert out["status"] == "match" and out["stage_diff_ft"] == 0.04 and out["flow_diff_pct"] < 1


def test_a_misheard_flow_digit_downgrades_a_matching_stage_to_close():
    radio = {"stage_ft": 7.6, "flow_cfs": 160, "missing": False}              # "266" heard as "160"
    assert nb.compare_river(radio, _official(7.55, 266), NOW)["status"] == "close"


def test_stage_differences_are_graded():
    r = {"stage_ft": 5.0, "flow_cfs": None, "missing": False}
    assert nb.compare_river(r, _official(5.1), NOW)["status"] == "match"
    assert nb.compare_river(r, _official(5.4), NOW)["status"] == "close"
    assert nb.compare_river(r, _official(6.5), NOW)["status"] == "differs"


def test_a_report_the_station_could_not_read_but_noaa_has_is_called_out():
    missing = {"stage_ft": None, "flow_cfs": None, "missing": True}
    assert nb.compare_river(missing, _official(2.0), NOW)["status"] == "radio_missing"
    assert nb.compare_river(missing, None, NOW)["status"] == "no_data"
    assert nb.compare_river(missing, {"stage_ft": -999, "flow_cfs": None, "at": 0}, NOW)["status"] == "no_data"


def test_no_official_reading_means_unchecked_and_a_stale_official_one_is_flagged():
    r = {"stage_ft": 5.0, "flow_cfs": None, "missing": False}
    assert nb.compare_river(r, None, NOW)["status"] == "unchecked"
    assert nb.compare_river(r, _official(5.0, age=5 * 3600), NOW)["official_stale"] is True


def test_each_forecast_area_appears_once_with_its_latest_text():
    text = ("Forecast for the Greater Portland metro area this afternoon, sunny. Highs around 70. "
            "Forecast for the North Oregon coast this afternoon, cloudy. "
            "Forecast for the Greater Portland metro area tonight, clear. Lows in the 50s.")
    out = nb.forecasts(text)
    assert [f["area"] for f in out] == ["Greater Portland Metro Area", "North Oregon Coast"]
    assert out[0]["text"].startswith("clear") or "Lows in the 50s" in out[0]["text"]


def test_a_repeated_gauge_keeps_the_reading_that_has_a_flow_even_if_a_later_one_lost_it():
    text = ("Sandy River near Bull Run, 7.6 feet, 266 CFS. Later: Sandy River near Bull Run, 7.6 feet. "
            "On the Willamette River, at Salem, 5.4 feet, with a flow of 70-57 CFS.")
    got = {r["name"]: r for r in nb.rivers(text, OFFICE)}
    assert got["Sandy River near Bull Run"]["flow_cfs"] == 266
    assert got["Willamette River at Salem"]["flow_cfs"] == 7057             # the hyphenated garble is repaired


def test_the_bar_note_stops_at_the_time_clause_and_does_not_run_into_the_currents():
    text = ("Forecast for the Columbia River Bar in the main channel, General Seas, 4-6 feet through Thursday evening. "
            "First ab, ab current of 5.19 knots at 7.30 pm Wednesday.")
    assert nb.marine(text)["bar"] == {"seas_ft": [4, 6], "note": "through Thursday evening"}
    assert nb.marine("Columbia River Bar, General Seas 3 to 5 feet.")["bar"]["note"] == ""
