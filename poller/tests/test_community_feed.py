import unittest

from normalizers.aircraft import normalize_tar1090
from pollers.adsb import parse_retry_after

AC = {"hex": "A31E86", "flight": "REH8    ", "r": "N30RX", "t": "EC35", "desc": "AIRBUS HELICOPTERS EC-135/635",
      "ownOp": "REACH AIR MEDICAL SERVICES LLC", "lat": 45.5, "lon": -122.7, "alt_baro": 1500, "gs": 110,
      "track": 90, "squawk": "1200", "category": "A7", "seen_pos": 0.4}


class CommunityFeedTests(unittest.TestCase):
    def test_source_and_static_identity_come_through(self):
        e = normalize_tar1090(AC, source="community")
        self.assertEqual(e["source"], "community")
        ident = e["identity"]
        self.assertEqual((ident["callsign"], ident["registration"], ident["icao_type"]), ("REH8", "N30RX", "EC35"))
        self.assertEqual(ident["operator"], "REACH AIR MEDICAL SERVICES LLC")
        self.assertEqual(ident["type"], "AIRBUS HELICOPTERS EC-135/635")

    def test_default_source_is_unchanged_and_blank_fields_are_left_out(self):
        bare = {"hex": "abc123", "flight": "", "lat": 45.4, "lon": -122.7, "alt_baro": "ground"}
        e = normalize_tar1090(bare)
        self.assertEqual(e["source"], "ultrafeeder")
        for key in ("registration", "icao_type", "type", "operator"):
            self.assertNotIn(key, e["identity"])

    def test_retry_after_headers(self):
        self.assertEqual(parse_retry_after({"x-rate-limit-retry-after-seconds": "36029"}), 36029)
        self.assertEqual(parse_retry_after({"retry-after": "30"}), 30)
        self.assertIsNone(parse_retry_after({}))
        self.assertIsNone(parse_retry_after({"retry-after": "soon"}))
        self.assertIsNone(parse_retry_after({"retry-after": "0"}))


if __name__ == "__main__":
    unittest.main()
