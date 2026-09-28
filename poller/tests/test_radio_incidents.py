"""Tests for P25 dispatch transcript -> incident extraction.

Fixtures are real (lightly trimmed) Portland-area dispatch transcripts in both
ASR styles: clean digits/punctuation and lower-case spelled-out numbers.

Run from poller/:
    pytest tests/test_radio_incidents.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import pytest

from radio_incidents import extract, normalise, parse_call

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
