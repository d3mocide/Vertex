import unittest

from pollers.utilities import summarize_outages

TUALATIN = (45.3842, -122.7623)


def tract(lon, lat, meters, county="Washington", utility="PORTLAND GENERAL ELECTRIC CO"):
    d = 0.01
    ring = [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]
    return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"utilityName": utility, "metersOut": meters, "metersServed": 1000,
                           "CountyName": county, "tract": 1}}


class OutageTests(unittest.TestCase):
    def test_near_list_is_sorted_and_titled(self):
        mapped, near = summarize_outages([tract(-122.76, 45.40, 5), tract(-122.70, 45.45, 30), tract(-122.9, 45.3, 2)], *TUALATIN)
        self.assertEqual(len(mapped), 3)
        self.assertEqual(near[0]["meters_out"], 5)          # nearest first
        self.assertEqual(near[0]["utility"], "Portland General Electric Co")

    def test_far_outages_are_left_off_the_map_and_the_near_list(self):
        mapped, near = summarize_outages([tract(-117.0, 44.0, 500)], *TUALATIN)
        self.assertEqual((mapped, near), ([], []))

    def test_mid_range_is_mapped_but_not_near(self):
        mapped, near = summarize_outages([tract(-122.0, 45.5, 40)], *TUALATIN)   # ~55 km east
        self.assertEqual(len(mapped), 1)
        self.assertEqual(near, [])

    def test_no_outages_is_an_empty_result_not_an_error(self):
        self.assertEqual(summarize_outages([], *TUALATIN), ([], []))


if __name__ == "__main__":
    unittest.main()
