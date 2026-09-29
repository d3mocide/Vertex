import unittest

from pollers.traffic import classify_incident, triage_incidents


def inc(title, severity="", description="", event="RW", sub="325", ramp=False, lat=45.53, lon=-122.66, updated="2026-09-25T00:00:00Z"):
    return {"title": title, "description": description, "severity": severity, "event": event, "event_sub": sub,
            "ramp": ramp, "lat": lat, "lon": lon, "pubDate": updated}


class ClassifyTests(unittest.TestCase):
    def test_a_full_closure_rated_no_delay_is_still_a_road_closure(self):
        got = classify_incident(inc("Traffic Impacts: Full closure of I-5 southbound.", "No to Minimum Delay"))
        self.assertEqual((got["kind"], got["scope"]), ("closure", "road"))

    def test_all_lanes_closed_and_closed_the_road(self):
        self.assertEqual(classify_incident(inc("All lanes of I-5 south closed 24/7 through early October.", "Closure with Detour"))["scope"], "road")
        self.assertEqual(classify_incident(inc("Road maintenance operations has closed the road SB . Follow detour.", "Closure"))["scope"], "road")
        self.assertEqual(classify_incident(inc("Cornelius Pass Road is currently closed at the Rock Creek Bridge", "Closure"))["scope"], "road")

    def test_ramp_closures(self):
        got = classify_incident(inc("The onramp from Weidler to I-5 SB closed. Use an alternate route.", "Closure", ramp=True))
        self.assertEqual((got["kind"], got["scope"]), ("closure", "ramp"))
        got = classify_incident(inc("Roadwork has the NB exit 9 for OR-99E closed until Friday 10/2.", "Closure"))
        self.assertEqual(got["scope"], "ramp")

    def test_night_closure_of_the_interstate_is_a_road_closure_despite_the_delay_rating(self):
        got = classify_incident(inc("Traffic Impacts: Closure of I-205, and lane and ramp closures in Oregon City.", "Estimated delay under 20 minutes"))
        self.assertEqual((got["kind"], got["scope"]), ("closure", "road"))

    def test_sidewalk_and_lane_notices_are_not_closures(self):
        for t in ("Traffic Impacts: Daytime lane shifts and sidewalk closures with accessible detours.",
                  "Traffic Impacts: Periodic daytime and nighttime single lane closures on SE 82nd Avenue."):
            got = classify_incident(inc(t, "No to Minimum Delay"))
            self.assertEqual((got["kind"], got["scope"]), ("low", None), t)

    def test_crash_is_an_unplanned_delay(self):
        got = classify_incident(inc("A crash has occurred. Prepare to slow or move over for worker safety.",
                                    "Estimated delay under 20 minutes", event="VH", sub="370"))
        self.assertEqual((got["kind"], got["unplanned"]), ("delay", True))

    def test_routine_construction_is_a_delay_or_low_and_planned(self):
        got = classify_incident(inc("Road construction is occurring. Prepare to slow. Watch for workers.", "Estimated delay under 20 minutes"))
        self.assertEqual((got["kind"], got["unplanned"]), ("delay", False))
        self.assertEqual(classify_incident(inc("Road construction is occurring causing minimal delay to traffic.", "No to Minimum Delay"))["kind"], "low")


class GroupTests(unittest.TestCase):
    def test_project_closures_cluster_and_the_road_closure_leads(self):
        items = [
            inc("The onramp from Weidler to I-5 SB closed.", "Closure", ramp=True, lat=45.5350, lon=-122.6600),
            inc("I-405 NB ramp to I-5 SB is closed.", "Closure", ramp=True, lat=45.5420, lon=-122.6700),
            inc("All lanes of I-5 south closed 24/7 through early October.", "Closure with Detour", lat=45.5380, lon=-122.6650),
            inc("Roadwork has the NB exit 9 for OR-99E closed.", "Closure", lat=45.35, lon=-122.60),
        ]
        out = triage_incidents(items)
        groups = {}
        for it in out:
            groups.setdefault(it["group"], []).append(it)
        rose = [g for g in groups.values() if len(g) == 3][0]
        self.assertEqual([m["lead"] for m in rose if m["scope"] == "road"], [True])
        self.assertEqual(sum(m["lead"] for m in rose), 1)
        self.assertTrue(all(m["group_size"] == 3 for m in rose))
        lone = [g for g in groups.values() if len(g) == 1][0][0]
        self.assertTrue(lone["lead"])

    def test_non_closures_are_never_grouped(self):
        out = triage_incidents([inc("Road construction is occurring causing minimal delay to traffic.", "No to Minimum Delay")])
        self.assertIsNone(out[0]["group"])


if __name__ == "__main__":
    unittest.main()
