"""Tests for P25 dispatch transcript -> incident extraction.

Fixtures are real (lightly trimmed) Portland-area dispatch transcripts in both
ASR styles: clean digits/punctuation and lower-case spelled-out numbers.

Run from poller/:
    pytest tests/test_radio_incidents.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import pytest

from radio_incidents import extract, is_hospital_tag, locate, normalise, parse_call

T0 = datetime(2026, 9, 25, 12, 0)


def call(text, minutes=0, tag="MC Fire Disp"):
    return parse_call(T0 + timedelta(minutes=minutes), 1809, tag, text)


@pytest.mark.parametrize("raw, expected", [
    ("four zero two northeast second avenue", "402 northeast 2nd avenue"),
    ("two seven one eight east burnside street", "2718 east burnside street"),
    ("forty four", "44"),
    ("3355 Southeast, 70th Avenue", "3355 southeast 70th avenue"),
])
def test_normalise_numbers(raw, expected):
    assert normalise(raw) == expected


@pytest.mark.parametrize("text, category, location", [
    ("19, on a fire alarm, 3355 Southeast, 70th Avenue, switching to Opus 1",
     "fire_alarm", "3355 SE 70th Ave"),
    ("request to respond code three north oregon street and northeast lloyd boulevard it was for a small outside fire",
     "outside_fire", "N Oregon St & NE Lloyd Blvd"),
    ("Truck 1, Anematic 1350, a priority 2, Charlie Breathing Problem, Southwest 2 Avenue, Southwest Oak Street, talk group is Ops 1",
     "medical", "SW 2nd Ave & SW Oak St"),
    ("Again, engine 13 going with truck 13 on the Bravo level, odor of gas outside North Lairby Avenue, North Broadway, respond",
     "gas_leak", "N Lairby Ave & N Broadway"),
    ("incident westbound steel standing on the railing on on the bridge staring down into the water fireboat twenty one truck thirteen",
     "water_rescue", "bridge (landmark)"),
])
def test_parse_call_category_and_location(text, category, location):
    c = call(text)
    assert c.category == category
    assert c.location == location


def test_code_number_is_not_a_house_number():
    c = call("request to respond code three north oregon street and northeast lloyd boulevard")
    assert not c.location.startswith("3 ")


def test_two_dispatches_in_one_transmission_use_nature_nearest_the_address():
    c = call("two on a priority three carbon mon one four seven two five northeast click attack court "
             "time out sixteen o two dispatch from c one is going to take the jumper call")
    assert c.category == "carbon_monoxide"
    assert c.location == "14725 NE Click Attack Ct"


def test_specific_fire_type_beats_generic_fire():
    assert call("structure fire 4321 north wygant street engine 14").category == "structure_fire"


def test_units_status_and_acuity():
    c = call("Medics, Delta assaults. Police will be responding as well. 5601 Southeast 145 Avenue. "
             "Engine 31 and Medic 338 on scene")
    assert c.units == ["Medic 338", "Engine 31"] or set(c.units) == {"Engine 31", "Medic 338"}
    assert c.status == "on_scene"
    assert c.acuity == "delta"


def test_asr_spelling_variants_cluster_into_one_incident():
    rows = [
        (T0, 1809, "MC Fire Disp", "fire at 4321 North Wygant Street, Engine 14, Truck 8 respond"),
        (T0 + timedelta(minutes=7), 1809, "MC Fire Disp", "structure fire 4321 North Wigan Street recall truck 8"),
    ]
    incidents = extract(rows)
    assert len(incidents) == 1
    inc = incidents[0]
    assert inc.category == "structure_fire"
    assert len(inc.calls) == 2
    assert set(inc.units) == {"Engine 14", "Truck 8"}
    assert inc.status == "cleared"


def test_same_address_after_gap_is_a_new_incident():
    rows = [
        (T0, 1809, "", "gas leak 700 north clarendon avenue engine 26"),
        (T0 + timedelta(hours=3), 1809, "", "gas leak 700 north clarendon avenue engine 26"),
    ]
    assert len(extract(rows)) == 2


def test_routine_unlocated_chatter_is_dropped_but_serious_unlocated_is_kept():
    rows = [
        (T0, 1809, "", "copy that, clear on the air, thank you"),
        (T0, 1809, "", "a priority 2 charlie sick person, respond ops 1"),
        (T0, 1809, "", "person struck by a freight train, engine 1 engine 3 squad 1 truck 1"),
    ]
    incidents = extract(rows)
    assert [i.category for i in incidents] == ["train_or_ped_struck"]


def test_ranking_puts_life_safety_first():
    rows = [
        (T0, 1809, "", "priority 4 charlie sick person 12345 northeast holiday street medic 1343"),
        (T0 + timedelta(minutes=1), 1809, "", "standing on the railing of the bridge fireboat 21 truck 13"),
        (T0 + timedelta(minutes=2), 1809, "", "traffic accident north columbia boulevard and north bank street engine 17"),
    ]
    assert [i.category for i in extract(rows)][:2] == ["water_rescue", "crash"]


def test_to_dict_is_json_friendly():
    inc = extract([(T0, 1809, "MC Fire Disp", "gas leak 700 north clarendon avenue engine 26 truck 22")])[0]
    d = inc.to_dict()
    assert d["category"] == "gas_leak"
    assert d["location"] == "700 N Clarendon Ave"
    assert d["call_count"] == 1
    assert d["first_seen"] == T0.isoformat()
    assert d["lat"] is None and d["geofences"] == []


# ── Deterministic enrichment (real CCOM dispatch, 2026-09-28) ────────────────

_MAIN_ST = ("322, Engine 309, Engine 317, Heavy Rescue 305, Rescue 301, and FD1 Rehab Group. Respond to "
            "commercial fire at 1909 Main Street. Cross streets are on 205 FWY McLaughlin Boulevard ramp "
            "southbound and Agnes Avenue. Working Channel Ops 26.")


def test_units_are_named_and_summarised_by_type():
    from radio_incidents import normalise, units_in, unit_summary
    units = units_in(normalise(_MAIN_ST))
    assert units == ["Engine 309", "Engine 317", "Heavy Rescue 305", "Rescue 301"]
    assert unit_summary(units) == "2 engines, a heavy rescue, a rescue"
    assert unit_summary(["AMR 123", "Medic 61", "Battalion 2"]) == "2 ambulances, a chief officer"


def test_cross_streets_nature_and_markers():
    from radio_incidents import normalise, cross_streets_in, markers_in, parse_call
    t = normalise("Engine 51 respond to a residential fire, cross streets are southwest bruce drive and "
                  "southwest princess avenue, occupants trapped, additional resources requested")
    assert cross_streets_in(t) == "SW Bruce Dr & SW Princess Ave"
    assert markers_in(t) == ["Entrapment", "More resources requested"]
    call = parse_call(datetime(2026, 9, 28, tzinfo=timezone.utc), 3250, "CCOM FD Disp", _MAIN_ST)
    assert call.nature == "Commercial fire" and call.category == "structure_fire"


def test_incident_dict_carries_the_enrichment():
    from radio_incidents import extract
    ts = datetime(2026, 9, 28, 2, 16, tzinfo=timezone.utc)
    [inc] = [i for i in extract([(ts, 3250, "CCOM FD Disp", _MAIN_ST)]) if i.location == "1909 Main St"]
    d = inc.to_dict()
    assert d["nature"] == "Commercial fire" and d["unit_summary"] == "2 engines, a heavy rescue, a rescue"
    assert "city" in d and "markers" in d and "cross_streets" in d


# ── Keyword false positives seen in the transcript corpus ────────────────────
# The nature patterns describe the incident, not a bare word: patients "shot for psychosis", people "giving it a
# shot", "shooting pain", "not an entrapment", "our MVC" and "canceled by fire" all outnumber the real thing.

@pytest.mark.parametrize("text, wrong", [
    ("let s give it a shot copy robert 49 thank you", "violence"),
    ("today has a history of similar a patient received a shot for psychosis", "violence"),
    ("he started having shooting pain that went from his lower back to his hip", "violence"),
    ("she has a sharp stabbing pain to the left side of her chest no radiation", "violence"),
    ("a male was shooting up drugs a caller said he s now unconscious with a coat over his head", "violence"),
    ("command from 214 the gas has been shot", "violence"),
    ("this is not an entrapment the patient is walking up the embankment currently", "rescue"),
    ("can you inform if we have any entrapments", "rescue"),
    ("it doesn t sound like she s entrapped just her door will not open on its own", "rescue"),
    ("adult female conscious now had collapsed while walking seemed disoriented and confused", "rescue"),
    ("it looks like our mvc doesn t have connection to the server so i m going to try power cycling", "crash"),
    ("this is just a disabled vehicle not a crash you can clear", "crash"),
    ("they don t crash into the helicopter", "crash"),
    ("sit tight you re canceled by fire on scene no patient contact", "fire"),
    ("fire com copies we are on scene", "fire"),
    ("engine 210 on fire attack engine 39 on fire supply", "fire"),
    ("engine 53 respond to miscellaneous non-fire at 9080 southwest 91st avenue", "fire"),
    ("no smoke no fire so far on the 1st floor", "outside_fire"),
    ("i m shooting at 12 05", "violence"),
    ("we ll give it a shot at 9 pm and see", "violence"),
])
def test_keyword_false_positives_are_not_incidents(text, wrong):
    assert call(text).category != wrong


@pytest.mark.parametrize("text, category", [
    ("life flight 1 all we have is adult male with a gunshot wound to the belly", "violence"),
    ("he shot himself in the stomach that s what we have", "violence"),
    ("respond with the police on a party 2 bravo penetrating stabbing wound", "violence"),
    ("crash with 1 individual out and the other still trapped do you want to upgrade", "rescue"),
    ("it s a small structure collapse with trees on the garage of the house", "rescue"),
    ("engine 66 respond to commercial fire at 6320 southwest main avenue", "structure_fire"),
    ("engine 53 respond to car fire at 8620 southwest hall boulevard", "vehicle_fire"),
    ("engine 56 respond to miscellaneous fire at 1275 kent street", "fire"),
    ("engine 17 respond to barn fire at 18375 northwest derry creek road", "fire"),
    ("the power line is on fire at 4840 south west dodge road", "fire"),
    ("engine 60 respond to smoke in the area at 6626 northwest thompson road", "outside_fire"),
    ("engine 61 spong traffic accident at southwest seahills boulevard and southwest parkway", "crash"),
])
def test_real_incident_phrasings_keep_their_category(text, category):
    assert call(text).category == category


def test_asr_fire_alarm_garbles_are_not_structure_fires():
    # "residential fire alarm" is heard as "residential firearm(s)" / "firelight"
    for text in ("engine 318 respond to residential firearm 24590 southeast silver road cross streets are southeast nola avenue",
                 "return to commercial firearms at 035 southwest 163rd avenue",
                 "residential firelight division 225257 this is for a kitchen smoke detector"):
        assert call(text).category == "fire_alarm", text


def test_a_stray_word_does_not_create_an_unlocated_serious_incident():
    rows = [(T0, 1809, "PCC DPS Disp", "i ll try it ll be just a minute but i ll give it a shot copy robert 49 thank you"),
            (T0, 1809, "WC AMR Disp", "sit tight you re canceled by fire on scene no patient contact"),
            (T0, 1809, "KSR WST HSP", "she has been having a sharp stabbing pain to the left side of the chest for hours")]
    assert extract(rows) == []


# ── Hospital patient reports ─────────────────────────────────────────────────

@pytest.mark.parametrize("tag", ["PROV SV HOSP", "KSR WST HSP", "MERDNPK HOS", "Tuality Hospital", "Some Medical Center"])
def test_hospital_tags_are_recognised(tag):
    assert is_hospital_tag(tag)


@pytest.mark.parametrize("tag", ["WC Fire Disp", "CCOM FD 24", "WC OPS 34", "CC AMR Disp", "", None])
def test_dispatch_and_ops_tags_are_not_hospital(tag):
    assert not is_hospital_tag(tag)


def test_site_specific_hospital_tags_can_be_configured():
    assert not is_hospital_tag("PROV NEWBRG")
    assert is_hospital_tag("PROV NEWBRG", ["newbrg"])
    assert not is_hospital_tag("WC Fire Disp", [""])   # an empty entry matches nothing


def test_hospital_patient_reports_do_not_become_incidents():
    report = ("code one with a 43 year old male coming in for an evaluation after a motor vehicle accident, "
              "pain in his neck, the patient was also assaulted earlier and has a gunshot history")
    rows = [(T0, 1, "PROV SV HOSP", report), (T0, 1, "PROV NEWBRG", report), (T0, 1, "WC Fire Disp", report)]
    assert len(extract(rows)) == 2                                  # "PROV NEWBRG" has no hospital marker...
    assert len(extract(rows, ["PROV NEWBRG"])) == 1                 # ...until configured: only the dispatch copy is left
    assert extract(rows[:2], ["PROV NEWBRG"]) == []


# ── Locations dispatch reads without a clean "number street suffix" ──────────

@pytest.mark.parametrize("text, expected", [
    ("engine 52 respond to natural gas leak at 11879 southwest austin cross streets are southwest 4th and main", "11879 SW Austin"),
    ("medic 5 respond at 360 east powell please respond on ops 1", "360 E Powell"),
    ("a party 2 baker traffic accident southeast 202 in burnside ops 1", "SE 202nd Ave & Burnside"),
    ("injury southwest 13 in jefferson for a scooter crash", "SW 13th Ave & Jefferson"),
    ("assault 3080 northeast martin luther king jr blvd your patient is in the lobby", "3080 NE Martin Luther King Jr Blvd"),
    ("traffic accident 984-1 north vancouver way respond on op 6", "9841 N Vancouver Way"),
    ("respond to a traffic accident westbound 84 at mile 3", "I-84"),
])
def test_additional_location_forms(text, expected):
    assert locate(normalise(text))[0] == expected


@pytest.mark.parametrize("text", [
    "938 east street unit 4 respond",              # "street" is a suffix, not a street name
    "a bravo level fall northeast 183 and bravo 401",   # MPDS level, not a cross street
    "engine 5 at 1234 on ops 1",                   # a number alone is not an address
])
def test_dispatch_filler_is_not_read_as_a_location(text):
    assert locate(normalise(text))[0] is None


# ── Linking calls into incidents ─────────────────────────────────────────────

def rows_of(*items):
    """items: (minutes, tag, text)"""
    return [(T0 + timedelta(minutes=m), 1, tag, text) for m, tag, text in items]


def test_street_name_spelled_two_ways_at_one_house_number_is_one_incident():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 56 engine 39 respond to commercial fire at 31240 southwest blooms ferry road cross streets are x and y"),
                          (6, "WC Fire Disp", "chief 6 respond to commercial fire at 31240 southwest boonesbury road cross streets are x and y")))
    assert len(inc) == 1 and len(inc[0].calls) == 2 and inc[0].category == "structure_fire"


def test_different_house_numbers_stay_separate():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 56 respond to commercial fire at 31240 southwest blooms ferry road"),
                          (6, "WC Fire Disp", "engine 57 respond to commercial fire at 31250 southwest blooms ferry road")))
    assert len(inc) == 2


def test_incompatible_natures_at_one_house_number_stay_separate():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 61 respond to traffic accident at 500 southwest main street"),
                          (5, "WC Fire Disp", "engine 62 respond to structure fire at 500 southwest oak street")))
    assert {i.category for i in inc} == {"crash", "structure_fire"} and len(inc) == 2


def test_same_house_number_after_the_gap_is_a_new_incident():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 56 respond to commercial fire at 31240 southwest blooms ferry road"),
                          (200, "WC Fire Disp", "engine 56 respond to commercial fire at 31240 southwest boonesbury road")))
    assert len(inc) == 2


DISPATCH = "engine 62 engine 67 respond to commercial fire at 100 southwest main street cross streets are oak street and elm street"


def test_an_addressless_cancel_closes_the_incident_its_unit_was_sent_to():
    inc = extract(rows_of((0, "WC Fire Disp", DISPATCH), (40, "WC OPS 35", "engine 62 is on scene now"), (90, "WC OPS 35", "engine 62 you can cancel")))
    assert len(inc) == 1 and inc[0].status == "cleared" and len(inc[0].calls) == 3


def test_a_status_call_whose_unit_matches_two_incidents_is_ignored():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 5 engine 62 respond to commercial fire at 100 southwest main street"),
                          (3, "WC Fire Disp", "engine 5 engine 70 respond to structure fire at 900 northeast elm street"),
                          (30, "WC OPS 35", "engine 5 you can cancel")))
    assert len(inc) == 2 and all(i.status == "active" for i in inc)


def test_status_traffic_hours_later_does_not_link():
    inc = extract(rows_of((0, "WC Fire Disp", DISPATCH), (400, "WC OPS 35", "engine 62 you can cancel")))
    assert len(inc) == 1 and inc[0].status == "active"


def test_a_serious_call_without_an_address_joins_the_incident_with_the_same_unit():
    inc = extract(rows_of((0, "CCOM FD Disp", "engine 322 engine 315 respond to natural gas leak at 6901 glen echo avenue cross streets are x and y"),
                          (4, "CCOM FD 24", "engine 322 bc 302 natural gas leak coming in, the informant is possibly smelling propane")))
    assert len(inc) == 1 and len(inc[0].calls) == 2 and inc[0].category == "gas_leak"


def test_a_serious_call_of_another_nature_does_not_join():
    inc = extract(rows_of((0, "CCOM FD Disp", "engine 322 respond to natural gas leak at 6901 glen echo avenue cross streets are x and y"),
                          (4, "CCOM FD 24", "engine 322 we have a person struck by a car here")))
    assert len(inc) == 2


def test_an_address_less_fire_read_heard_with_the_addressed_dispatch_is_the_same_incident():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 5 respond to residential fire at 2345 southeast brookwood avenue cross streets are x and y"),
                          (1, "WC OPS 35", "copy we are about to tap a residential fire we will show you clear")))
    assert len(inc) == 1 and len(inc[0].calls) == 2


def test_a_nearby_address_less_fire_does_not_join_when_it_is_too_late_or_ambiguous():
    late = extract(rows_of((0, "WC Fire Disp", "engine 5 respond to residential fire at 2345 southeast brookwood avenue cross streets are x"),
                           (10, "WC OPS 35", "copy we are about to tap a residential fire we will show you clear")))
    assert len(late) == 2
    two = extract(rows_of((0, "WC Fire Disp", "engine 5 respond to residential fire at 2345 southeast brookwood avenue"),
                          (1, "CCOM FD Disp", "engine 9 respond to residential fire at 700 northeast oak street"),
                          (2, "WC OPS 35", "copy we are about to tap a residential fire we will show you clear")))
    assert len(two) == 3


def test_address_less_assault_chatter_never_joins_an_assault_elsewhere():
    inc = extract(rows_of((0, "WC Fire Disp", "engine 62 and amr 109 respond to assault at 7067 southeast blanton street cross streets are x and y"),
                          (1, "WC Fire Disp", "firepower 364 has the assault engine closed we are clear")))
    assert len(inc) == 2
