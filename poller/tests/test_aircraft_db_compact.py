"""Tests for the compact (array-backed) aircraft DB and EONET region scoping.

Run from poller/:
    pytest tests/test_aircraft_db_compact.py
"""
from __future__ import annotations

import gzip
import os
import sys
from types import SimpleNamespace

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import enrichment.aircraft_db as adb


def _db(tmp_path, monkeypatch, rows: list[str], gz: bool = True):
    path = tmp_path / ("db.csv.gz" if gz else "db.csv")
    data = "\n".join(rows) + "\n"
    if gz:
        with gzip.open(path, "wt") as fh:
            fh.write(data)
    else:
        path.write_text(data)
    monkeypatch.setattr(adb, "settings", SimpleNamespace(adsb_aircraft_db_path=str(path)))
    monkeypatch.setattr(adb.AircraftDb, "_candidate_paths", lambda self: [str(path)])
    return adb.AircraftDb()


def test_lookup_returns_same_shape_as_before(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch, [
        "a00001;N1;C172;;CESSNA 172",
        "a00002;N2;B738;;BOEING 737-800",
        "a00003;N3;B738;;BOEING 737-800",
    ])
    assert len(db) == 3
    assert db.lookup("A00002") == {"registration": "N2", "type_icao": "B738", "type_long": "BOEING 737-800"}
    assert db.lookup(" a00001 ") == {"registration": "N1", "type_icao": "C172", "type_long": "CESSNA 172"}
    assert db.lookup("a00009") is None
    assert db.lookup("zzz") is None
    assert db.lookup(None) is None
    assert len(db._types) == 2  # type pairs are shared, not stored per row


def test_unsorted_input_and_duplicates_last_row_wins(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch, [
        "c00000;N30;;;",
        "b00000;N20;PA28;;PIPER",
        "a00000;N10;;;",
        "b00000;N21;PA32;;PIPER SARATOGA",   # later duplicate replaces the earlier row
        "bad-row",
        ";;;;",
        "d00000;;;;",                         # no data -> skipped
    ], gz=False)
    assert list(db._icaos) == sorted(db._icaos) and len(db) == 3
    assert db.lookup("b00000")["registration"] == "N21"
    assert db.lookup("b00000")["type_icao"] == "PA32"
    assert db.lookup("c00000") == {"registration": "N30", "type_icao": "", "type_long": ""}
    assert db.lookup("d00000") is None


def test_unbounded_eonet_sources_are_scoped_to_the_region(monkeypatch):
    import pollers.fire as fire
    monkeypatch.setattr(fire, "settings", SimpleNamespace(
        region_lat=45.3842, region_lon=-122.7635, fire_regional_radius_km=1200))
    base = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires"
    assert "&bbox=" in fire._with_region_bbox(base)
    assert fire._with_region_bbox(base + "&bbox=1,2,3,4") == base + "&bbox=1,2,3,4"
    assert fire._with_region_bbox("https://example.org/fires.json") == "https://example.org/fires.json"


def test_owner_and_flags_columns_are_loaded_and_survive_sorting(tmp_path, monkeypatch):
    # Out of order rows exercise the sort/dedupe path, which must carry owner and flags along.
    db = _db(tmp_path, monkeypatch, [
        "a00003;N3;B407;00;BELL 407;2015;LIFE FLIGHT NETWORK LLC;",
        "a00001;N1;C172;01;CESSNA 172;1999;MERCY FLIGHTS INC;",
        "a00002;N2;B738;00;BOEING 737;2020;Miscode - VARIOUS;",
        "a00004;N4;PA28;00;PIPER;;;",
    ])
    assert db.lookup_owner("a00001") == "MERCY FLIGHTS INC"
    assert db.lookup_owner("A00003") == "LIFE FLIGHT NETWORK LLC"
    assert db.lookup_owner("a00002") == ""          # "Miscode" placeholders are not owners
    assert db.lookup_owner("a00004") == ""
    assert db.lookup_owner("a00009") == ""
    assert db.lookup_flags("a00001") == 1           # military bit
    assert db.lookup_flags("a00003") == 0
    assert db.lookup("a00003")["registration"] == "N3"      # lookup() itself is unchanged


def test_old_five_column_files_still_load_without_owners(tmp_path, monkeypatch):
    db = _db(tmp_path, monkeypatch, ["a00001;N1;C172;;CESSNA 172"])
    assert db.lookup("a00001")["registration"] == "N1"
    assert db.lookup_owner("a00001") == ""
