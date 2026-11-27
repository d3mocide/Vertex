import unittest

from pollers.weather import normalize_aviation_obs


def _metar(icao, lat, lon, cat="VFR", **extra):
    return dict({"icaoId": icao, "lat": lat, "lon": lon, "fltCat": cat, "name": f"{icao} field",
                 "reportTime": "2026-11-27T02:13:00.000Z", "rawOb": f"METAR {icao} ...", "temp": 12.8,
                 "wdir": 250, "wspd": 3, "visib": "10+"}, **extra)


class AviationObsTests(unittest.TestCase):
    CENTER = (45.38, -122.76)

    def test_nearest_first_with_flight_category(self):
        payload = [_metar("KFAR", 45.85, -122.76, "IFR"), _metar("KNEAR", 45.40, -122.76, "mvfr")]
        out = normalize_aviation_obs(payload, *self.CENTER)
        self.assertEqual([s["icao"] for s in out], ["KNEAR", "KFAR"])
        self.assertEqual(out[0]["flight_category"], "MVFR")          # upper-cased
        self.assertLess(out[0]["dist_km"], out[1]["dist_km"])
        self.assertEqual(out[0]["obs_time"], "2026-11-27T02:13:00.000Z")

    def test_drops_far_and_malformed_stations_and_caps(self):
        payload = [_metar("KOUT", 47.0, -122.76), {"icaoId": "KBAD"}, "junk", _metar("KNOC", 45.39, -122.76, None)]
        payload += [_metar(f"K{i:03d}", 45.38 + i * 0.01, -122.76) for i in range(10)]
        out = normalize_aviation_obs(payload, *self.CENTER, limit=6)
        icaos = [s["icao"] for s in out]
        self.assertEqual(len(out), 6)
        self.assertNotIn("KOUT", icaos)                               # outside the radius
        self.assertNotIn("KBAD", icaos)                               # no position
        noc = [s for s in normalize_aviation_obs(payload, *self.CENTER, limit=50) if s["icao"] == "KNOC"]
        self.assertIsNone(noc[0]["flight_category"])                  # no category: kept, but None

    def test_non_list_payload(self):
        self.assertEqual(normalize_aviation_obs({"error": "x"}, *self.CENTER), [])


if __name__ == "__main__":
    unittest.main()
