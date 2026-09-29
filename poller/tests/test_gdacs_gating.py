import unittest

from pollers.gdacs import _MAX_KM, _alert_severity, _distance_gating


class GdacsGatingTests(unittest.TestCase):
    def test_only_nearby_events_are_kept(self):
        self.assertTrue(_distance_gating(120, "Green", "WF"))
        self.assertTrue(_distance_gating(_MAX_KM, "Orange", "FL"))
        self.assertFalse(_distance_gating(_MAX_KM + 1, "Green", "WF"))

    def test_far_red_alerts_no_longer_get_through(self):
        self.assertFalse(_distance_gating(8000, "Red", "WF"))

    def test_irrelevant_kinds_are_dropped_even_when_close(self):
        for kind in ("TC", "DR", "EQ"):     # cyclone, drought, earthquake (seismic poller has it)
            self.assertFalse(_distance_gating(50, "Red", kind))

    def test_cascades_volcano_and_tsunami_pass(self):
        self.assertTrue(_distance_gating(90, "Orange", "VO"))
        self.assertTrue(_distance_gating(300, "Red", "TS"))

    def test_severity_follows_alert_level(self):
        self.assertEqual(_alert_severity("Red", 10), "high")
        self.assertEqual(_alert_severity("Orange", 10), "medium")
        self.assertEqual(_alert_severity("Green", 10), "low")


if __name__ == "__main__":
    unittest.main()
