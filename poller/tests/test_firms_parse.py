import unittest

from pollers.firms import merge_hotspots, parse_firms_csv

CSV = """latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
45.10,-122.10,340.1,0.4,0.4,2026-09-28,2144,N,VIIRS,h,2.0NRT,300.2,12.5,D
45.10,-122.10,338.0,0.4,0.4,2026-09-28,2210,1,VIIRS,n,2.0NRT,299.0,9.0,D
45.30,-122.70,330.0,0.4,0.4,2026-09-28,0930,N,VIIRS,l,2.0NRT,290.0,1.0,N
40.00,-110.00,330.0,0.4,0.4,2026-09-28,0930,N,VIIRS,h,2.0NRT,290.0,1.0,N
"""
TUALATIN = (45.3842, -122.7623)


class FirmsTests(unittest.TestCase):
    def test_parse_drops_low_confidence_and_far_rows(self):
        spots = parse_firms_csv(CSV, *TUALATIN, radius_km=150)
        self.assertEqual(len(spots), 2)                       # low-confidence and Utah rows gone
        self.assertEqual({s["confidence"] for s in spots}, {"high", "nominal"})
        self.assertTrue(all(s["dist_km"] <= 150 for s in spots))
        self.assertTrue(spots[0]["ts"].startswith("2026-09-28T21:44"))

    def test_merge_collapses_the_same_spot_seen_twice_keeping_the_newest(self):
        spots = merge_hotspots(parse_firms_csv(CSV, *TUALATIN, radius_km=150))
        self.assertEqual(len(spots), 1)
        self.assertTrue(spots[0]["ts"].startswith("2026-09-28T22:10"))

    def test_garbage_rows_are_ignored(self):
        self.assertEqual(parse_firms_csv("latitude,longitude\nx,y\n", *TUALATIN, radius_km=150), [])


if __name__ == "__main__":
    unittest.main()
