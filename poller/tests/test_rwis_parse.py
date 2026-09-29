import unittest

from pollers.traffic import parse_rwis

TUALATIN = (45.3842, -122.7623)

INVENTORY = [
    {"station-id": 1, "station-name": "RWIS OR217 SB @ Greenburg Rd MP5.43",
     "latitude": 45.44, "longitude": -122.77, "elevation": 200, "route-id": "OR217"},
    {"station-id": 2, "station-name": "RWIS I84 WB @ Rye Valley MP340",
     "latitude": 44.44, "longitude": -117.33, "elevation": 2230, "route-id": "I84"},
    {"station-id": 3, "station-name": "RWIS Nothing Reporting",
     "latitude": 45.5, "longitude": -122.8, "elevation": 100, "route-id": "X"},
]
STATUS = [
    {"station-id": 1,
     "RoadWeather": {"air-temperature": 1780, "dewpoint-temp": 150, "avg-wind-speed": 6,
                     "avg-wind-gust-speed": 12, "relative-humidity": 54, "visibility": 2000,
                     "precip-type": "No Precipitation", "last-update-time": "2026-09-29T03:07:40Z"},
     "SurfaceCondition": {"surface-temperatures": [{"sensor-id": 0, "surface-temperature": 300}]}},
    {"station-id": 2, "RoadWeather": {"air-temperature": 1640}},
    {"station-id": 3, "RoadWeather": {"air-temperature": 32767, "avg-wind-speed": 32767,
                                       "relative-humidity": 32767}, "SurfaceCondition": {"surface-temperatures": []}},
]


class RwisTests(unittest.TestCase):
    def setUp(self):
        self.rows = parse_rwis(INVENTORY, STATUS, *TUALATIN)

    def test_only_nearby_stations_with_a_reading_are_returned(self):
        self.assertEqual([r["id"] for r in self.rows], [1])   # #2 is far, #3 has no data

    def test_units_are_converted(self):
        r = self.rows[0]
        self.assertAlmostEqual(r["temp_f"], 64.0, places=1)       # 17.8 °C
        self.assertAlmostEqual(r["surface_f"], 37.4, places=1)    # 3.0 °C
        self.assertEqual(r["wind_mph"], 6)
        self.assertEqual(r["gust_mph"], 12)
        self.assertIsNone(r["precip"])
        self.assertEqual(r["name"], "OR217 SB @ Greenburg Rd MP5.43")

    def test_stations_without_a_usable_id_are_skipped(self):
        inv = [{"station-id": -1, "station-name": "WWS A", "latitude": 45.4, "longitude": -122.7}]
        st = [{"station-id": -1, "RoadWeather": {"air-temperature": 1500}}]
        self.assertEqual(parse_rwis(inv, st, *TUALATIN), [])

    def test_missing_sentinels_become_none(self):
        rows = parse_rwis(INVENTORY, [{"station-id": 1, "RoadWeather": {
            "air-temperature": 2000, "relative-humidity": 32767, "visibility": 32767}}], *TUALATIN)
        self.assertIsNone(rows[0]["humidity"])
        self.assertIsNone(rows[0]["visibility_m"])


if __name__ == "__main__":
    unittest.main()
