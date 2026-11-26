"""The nearest-navaid lookup and the per-airport reference cache used by the ADS-B snapshot."""
from __future__ import annotations

import importlib.util
import os
import random
import sys
import unittest
from unittest.mock import MagicMock, patch

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from normalizers.beast_math import haversine_km  # noqa: E402


def _load_navaids_module():
    """Load the real enrichment/navaids_db.py by path: other test modules replace `enrichment.navaids_db` and `config`
    in sys.modules with mocks, so a plain import could return a mock depending on test order."""
    spec = importlib.util.spec_from_file_location(
        "_navaids_db_under_test", os.path.join(_POLLER_ROOT, "enrichment", "navaids_db.py"))
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"config": MagicMock()}):
        spec.loader.exec_module(module)
    return module


def _brute_force(items, lat, lon, max_km):
    best, best_d = None, float("inf")
    for item in items:
        d = haversine_km(lat, lon, item["lat"], item["lon"])
        if d <= max_km and d < best_d:
            best, best_d = item, d
    return best, best_d


class NearestNavaidTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.NavaidsDb = _load_navaids_module().NavaidsDb

    def _db(self, items):
        db = object.__new__(self.NavaidsDb)
        db._items = items
        return db

    def test_latitude_prefilter_gives_the_same_answer_as_a_full_scan(self):
        rng = random.Random(1234)
        items = [{"ident": f"N{i}", "name": "", "type": "VOR", "lat": rng.uniform(-89, 89), "lon": rng.uniform(-180, 180)}
                 for i in range(3000)]
        # Dense clusters, so many queries have several candidates near the 80 km edge.
        for _ in range(40):
            clat, clon = rng.uniform(-80, 80), rng.uniform(-180, 180)
            items += [{"ident": "C", "name": "", "type": "NDB", "lat": clat + rng.uniform(-1, 1),
                       "lon": clon + rng.uniform(-1, 1)} for _ in range(25)]
        db = self._db(items)
        for _ in range(400):
            item = rng.choice(items)
            lat, lon = item["lat"] + rng.uniform(-0.9, 0.9), item["lon"] + rng.uniform(-0.9, 0.9)
            for max_km in (10.0, 80.0, 150.0):
                want, want_d = _brute_force(items, lat, lon, max_km)
                got = db.nearest(lat, lon, max_km=max_km)
                if want is None:
                    self.assertIsNone(got)
                else:
                    self.assertEqual((got["lat"], got["lon"]), (want["lat"], want["lon"]))
                    self.assertEqual(got["distance_km"], round(want_d, 1))

    def test_edge_of_range_near_the_poles_and_the_antimeridian(self):
        db = self._db([{"ident": "A", "name": "", "type": "VOR", "lat": 89.9, "lon": 179.9},
                       {"ident": "B", "name": "", "type": "VOR", "lat": -0.7, "lon": -179.95}])
        self.assertEqual(db.nearest(89.9, -179.9, max_km=80.0)["ident"], "A")   # across the antimeridian, near the pole
        self.assertEqual(db.nearest(0.0, 179.95, max_km=80.0)["ident"], "B")    # 0.7 degrees of latitude is ~78 km
        self.assertIsNone(db.nearest(0.0, 179.95, max_km=70.0))
        self.assertIsNone(db.nearest(None, 10.0))


class AirportReferenceCacheTests(unittest.TestCase):
    def _poller(self):
        from pollers.adsb import AdsbPoller
        poller = object.__new__(AdsbPoller)
        poller._airport_ref_cache = {}
        poller._airports_db = MagicMock()
        poller._airports_db.lookup.side_effect = lambda code: (
            {"icao": code, "name": "Test Field", "lat": 45.0, "lon": -122.0} if code == "KTST" else None)
        poller._navaids_db = MagicMock()
        poller._navaids_db.nearest.return_value = {"ident": "TST", "distance_km": 3.2}
        return poller

    def test_each_airport_is_built_once(self):
        poller = self._poller()
        for _ in range(50):
            self.assertEqual(poller._airport_reference("KTST")["navaid"]["ident"], "TST")
            self.assertIsNone(poller._airport_reference("KNON"))
        self.assertEqual(poller._navaids_db.nearest.call_count, 1)
        self.assertEqual(poller._airports_db.lookup.call_count, 2)

    def test_callers_get_independent_copies(self):
        poller = self._poller()
        first = poller._airport_reference("KTST")
        first["metar"] = "KTST 261853Z ..."
        self.assertNotIn("metar", poller._airport_reference("KTST"))
        entry = poller._airport_snapshot_entry("KTST")
        self.assertIsNone(entry["metar"])
        self.assertNotIn("metar", poller._airport_reference("KTST"))

    def test_invalid_codes_are_not_cached(self):
        poller = self._poller()
        for code in (None, "", "PDX", "KPDXX", 1234):
            self.assertIsNone(poller._airport_reference(code))
        self.assertEqual(poller._airport_ref_cache, {})


if __name__ == "__main__":
    unittest.main()
