import unittest

from pollers.traffic import _parse_odot_flow, parse_signs, summarize_corridors
from types import SimpleNamespace
from unittest.mock import patch

TUALATIN = (45.3842, -122.7623)


def lane(sid, count, speed):
    return {"detector-list": {"detector-data-detail": {"station-id": sid, "vehicle-count": count, "vehicle-speed": speed,
                                                        "vehicle-occupancy": 5}}}


STATIONS = {
    1: {"road": "R2 I-5", "loc": "Nyberg", "dir": "N", "cls": "MAINLINE", "lat": 45.36, "lon": -122.75},
    2: {"road": "I-5", "loc": "Ramp", "dir": "N", "cls": "RAMP", "lat": 45.36, "lon": -122.75},
    3: {"road": "OR-99W", "loc": "Tigard", "dir": "N", "cls": "MAINLINE", "lat": 45.4, "lon": -122.77},
}


class FlowTests(unittest.TestCase):
    @patch("pollers.traffic.settings", SimpleNamespace(traffic_flow_corridors="I-5,I-205"))
    def test_lanes_are_aggregated_ramps_and_other_roads_dropped(self):
        data = {"detector-data-items": [lane(1, 10, 60), lane(1, 30, 40), lane(1, 0, 0),
                                        lane(2, 5, 30), lane(3, 5, 50)]}
        rows = _parse_odot_flow(data, STATIONS)
        self.assertEqual([r["id"] for r in rows], ["1"])
        self.assertEqual(rows[0]["road"], "I-5")               # region prefix dropped
        self.assertEqual(rows[0]["speed"], 45)                 # (10*60 + 30*40) / 40 — the empty lane is ignored
        self.assertEqual(rows[0]["vol"], 40)

    @patch("pollers.traffic.settings", SimpleNamespace(traffic_flow_corridors="I-5"))
    def test_a_station_with_no_traffic_has_no_speed_not_zero(self):
        rows = _parse_odot_flow({"detector-data-items": [lane(1, 0, 0)]}, STATIONS)
        self.assertIsNone(rows[0]["speed"])


def st(road, direction, speed, vol=5, lat=45.36, lon=-122.75, loc="x"):
    return {"road": road, "dir": direction, "speed": speed, "vol": vol, "lat": lat, "lon": lon, "loc": loc}


class CorridorTests(unittest.TestCase):
    def by_label(self, rows):
        return {r["label"]: r for r in rows}

    def test_normal_slow_heavy_by_median(self):
        rows = self.by_label(summarize_corridors(
            [st("I-5", "N", 62), st("I-5", "N", 58), st("I-5", "S", 38), st("I-5", "S", 40),
             st("I-205", "N", 12), st("I-205", "N", 15)], *TUALATIN))
        self.assertEqual(rows["I-5 Northbound"]["status"], "normal")
        self.assertEqual(rows["I-5 Southbound"]["status"], "slow")
        self.assertEqual(rows["I-205 Northbound"]["status"], "heavy")

    def test_two_crawling_spots_flag_slow_even_if_the_median_is_fine(self):
        rows = summarize_corridors([st("I-5", "N", 65), st("I-5", "N", 65), st("I-5", "N", 66),
                                    st("I-5", "N", 10, loc="Terwilliger"), st("I-5", "N", 12)], *TUALATIN)
        self.assertEqual(rows[0]["status"], "slow")
        self.assertEqual(rows[0]["slowest"], {"loc": "Terwilliger", "speed": 10})

    def test_a_single_slow_vehicle_is_not_a_queue(self):
        rows = summarize_corridors([st("I-5", "N", 65, vol=20), st("I-5", "N", 66, vol=20),
                                    st("I-5", "N", 2, vol=1), st("I-5", "N", 3, vol=1)], *TUALATIN)
        self.assertEqual(rows[0]["status"], "normal")
        self.assertEqual(rows[0]["slowest"]["speed"], 65)

    def test_no_traffic_is_quiet_and_no_reports_is_nodata(self):
        quiet = summarize_corridors([st("I-5", "N", None, vol=0)], *TUALATIN)[0]
        self.assertEqual(quiet["status"], "quiet")
        nodata = summarize_corridors([st("I-5", "N", None, vol=3)], *TUALATIN)[0]
        self.assertEqual(nodata["status"], "nodata")

    def test_far_stations_and_ordering(self):
        rows = summarize_corridors([st("OR-217", "N", 55), st("I-5", "N", 60),
                                    st("I-84", "E", 60, lat=44.0, lon=-121.0)], *TUALATIN)
        self.assertEqual([r["road"] for r in rows], ["I-5", "OR-217"])   # I-84 detector is out of range


class SignTests(unittest.TestCase):
    INV = [{"device-id": 1, "device-name": "VMS I5 NB @ Nyberg", "latitude": 45.36, "longitude": -122.75, "route-id": "I5"},
           {"device-id": 2, "device-name": "VMS far", "latitude": 41.9, "longitude": -122.6, "route-id": "I5"},
           {"device-id": 3, "device-name": "VMS blank", "latitude": 45.4, "longitude": -122.7, "route-id": "I5"},
           {"device-id": 4, "device-name": "VMS dark", "latitude": 45.41, "longitude": -122.7, "route-id": "I5"}]
    STS = [{"device-id": 1, "dms-device-status": "in service",
            "dmsCurrentMessage": {"phase1Line1": "I-5 SB CLOSED", "phase1Line2": "AT I-405", "phase1Line3": ""}},
           {"device-id": 2, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "FAR AWAY"}},
           {"device-id": 3, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": ""}},
           {"device-id": 4, "dms-device-status": "out of service", "dmsCurrentMessage": {"phase1Line1": "STALE"}}]

    def test_only_nearby_signs_with_a_live_message(self):
        signs = parse_signs(self.INV, self.STS, *TUALATIN)
        self.assertEqual([s["id"] for s in signs], [1])
        self.assertEqual(signs[0]["text"], "I-5 SB CLOSED / AT I-405")
        self.assertEqual(signs[0]["kind"], "message")

    def test_travel_times_are_labelled_and_sorted_after_messages(self):
        inv = [{"device-id": 1, "device-name": "TT", "latitude": 45.385, "longitude": -122.76},
               {"device-id": 2, "device-name": "MSG", "latitude": 45.5, "longitude": -122.7}]
        sts = [{"device-id": 1, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "TRAVEL TIME TO:", "phase1Line2": "I-84 20 MIN"}},
               {"device-id": 2, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "CRASH AHEAD"}}]
        signs = parse_signs(inv, sts, *TUALATIN)
        self.assertEqual([(s["id"], s["kind"]) for s in signs], [(2, "message"), (1, "travel")])


class SignKindTests(unittest.TestCase):
    def test_run_together_travel_times_are_still_travel_times(self):
        inv = [{"device-id": 1, "device-name": "VMS x", "latitude": 45.4, "longitude": -122.7}]
        sts = [{"device-id": 1, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "84VIA HOGANVIA 181ST18MIN20MINTIME"}}]
        self.assertEqual(parse_signs(inv, sts, *TUALATIN)[0]["kind"], "travel")


class SpeedSignTests(unittest.TestCase):
    def test_per_lane_speed_signs_collapse_and_rank_after_messages(self):
        inv = [{"device-id": i, "device-name": f"VAS I205 SB @ OR213 ({l} Lane) MP10.19", "latitude": 45.4, "longitude": -122.7}
               for i, l in enumerate("ABC", start=1)]
        inv.append({"device-id": 9, "device-name": "VMS I5 NB @ x", "latitude": 45.5, "longitude": -122.7})
        sts = [{"device-id": i, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "SLOW"}} for i in (1, 2, 3)]
        sts.append({"device-id": 9, "dms-device-status": "in service", "dmsCurrentMessage": {"phase1Line1": "CRASH AHEAD"}})
        signs = parse_signs(inv, sts, *TUALATIN)
        self.assertEqual([(s["kind"], s["text"]) for s in signs], [("message", "CRASH AHEAD"), ("speed", "SLOW")])
        self.assertNotIn("Lane", signs[1]["name"])


if __name__ == "__main__":
    unittest.main()
