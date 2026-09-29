import unittest

from pollers.odf_fire_danger import summarise_danger


def square(lon0, lat0, lon1, lat1):
    return {"type": "Polygon", "coordinates": [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]]}


def zone(name, level, geom):
    return {"type": "Feature", "geometry": geom, "properties": {"regusearea": name, "firedanger": level, "district": 1}}


class OdfDangerTests(unittest.TestCase):
    def test_point_inside_a_zone_is_home(self):
        out = summarise_danger([zone("A-1", 2, square(-123, 45, -122, 46))], 45.4, -122.7)
        self.assertEqual(out["home"]["zone"], "A-1")
        self.assertEqual(out["home"]["label"], "Moderate")

    def test_valley_floor_has_no_home_zone_but_lists_the_nearest(self):
        feats = [zone("NEAR", 3, square(-122.5, 45.0, -122.0, 45.3)),
                 zone("FAR", 1, square(-118, 42, -117, 43))]
        out = summarise_danger(feats, 45.4, -122.7)
        self.assertIsNone(out["home"])
        self.assertEqual([z["zone"] for z in out["nearby"]], ["NEAR"])   # FAR is out of range
        self.assertEqual(out["nearby"][0]["label"], "High")

    def test_a_hole_is_not_inside(self):
        outer = [[-123, 45], [-122, 45], [-122, 46], [-123, 46], [-123, 45]]
        hole = [[-122.8, 45.3], [-122.6, 45.3], [-122.6, 45.5], [-122.8, 45.5], [-122.8, 45.3]]
        geom = {"type": "Polygon", "coordinates": [outer, hole]}
        self.assertIsNone(summarise_danger([zone("H", 1, geom)], 45.4, -122.7)["home"])

    def test_unknown_levels_are_ignored(self):
        self.assertEqual(summarise_danger([zone("X", 9, square(-123, 45, -122, 46))], 45.4, -122.7),
                         {"home": None, "nearby": []})


if __name__ == "__main__":
    unittest.main()
