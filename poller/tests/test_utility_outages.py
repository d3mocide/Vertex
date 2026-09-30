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



class OutageContextTests(unittest.TestCase):
    NOW = 1_800_000_000

    def test_weather_alert_is_context_but_a_flood_watch_off_topic_alert_is_not(self):
        from pollers.utilities import outage_context
        got = outage_context([{"event": "High Wind Warning"}, {"event": "Air Quality Alert"}], [], 45.4, -122.7, self.NOW)
        self.assertEqual(got, ["High Wind Warning in effect"])

    def test_recent_close_lightning_counts_old_or_far_does_not(self):
        from pollers.utilities import outage_context
        strikes = [{"lat": 45.41, "lon": -122.7, "ts": (self.NOW - 600) * 1000},        # 10 min ago, close
                   {"lat": 45.42, "lon": -122.7, "ts": (self.NOW - 1200) * 1000},       # 20 min ago, close
                   {"lat": 45.41, "lon": -122.7, "ts": (self.NOW - 7200) * 1000},       # 2 h ago
                   {"lat": 47.0, "lon": -122.7, "ts": (self.NOW - 60) * 1000}]          # far
        got = outage_context([], strikes, 45.4, -122.7, self.NOW)
        self.assertEqual(got, ["2 lightning strikes within 25 km in the last hour"])

    def test_nothing_to_say_is_an_empty_list(self):
        from pollers.utilities import outage_context
        self.assertEqual(outage_context([], [], 45.4, -122.7, self.NOW), [])
        self.assertEqual(outage_context([{"event": "Wind Advisory"}], [], None, None, self.NOW), ["Wind Advisory in effect"])


if __name__ == "__main__":
    unittest.main()


def test_utility_totals_include_far_areas_and_preserve_zero_reports():
    from pollers.utilities import utility_summaries
    features=[tract(-122.76,45.40,5,utility='EXAMPLE ELECTRIC'),tract(-117,44,500,utility='EXAMPLE ELECTRIC'),tract(-122.76,45.40,0,utility='OTHER ELECTRIC')]
    _,near=summarize_outages(features,*TUALATIN)
    rows=utility_summaries(features,near)
    assert rows[0]['meters_out']==505 and rows[0]['nearby_meters_out']==5
    assert rows[0]['name']=='Example Electric' and rows[0]['coverage']=='Oregon'
    assert rows[1]['meters_out']==0 and utility_summaries([],[])==[]
