"""AIS static data: message 5 (ShipStaticData) and message 24 (StaticDataReport) both feed the vessel identity."""
from normalizers import vessel


def _position(mmsi="367000001", name=""):
    return {
        "MessageType": "PositionReport",
        "MetaData": {"MMSI": int(mmsi), "ShipName": name, "time_utc": "2026-10-03 12:00:00.000000000 +0000 UTC"},
        "Message": {"PositionReport": {"Latitude": 45.5, "Longitude": -122.7, "Sog": 4.0, "Cog": 90.0,
                                       "TrueHeading": 90, "NavigationalStatus": 0, "Valid": True}},
    }


def _report(mmsi, part_a=None, part_b=None, name=""):
    report = {"MessageID": 24, "Valid": True}
    if part_a is not None:
        report["PartNumber"] = False
        report["ReportA"] = part_a
    if part_b is not None:
        report["PartNumber"] = True
        report["ReportB"] = part_b
    return {"MessageType": "StaticDataReport", "MetaData": {"MMSI": int(mmsi), "ShipName": name},
            "Message": {"StaticDataReport": report}}


def setup_function():
    vessel._static_cache.clear()


def test_class_b_static_report_supplies_type_name_and_size():
    mmsi = "367000001"
    assert vessel.normalize_aisstream(_report(mmsi, part_a={"Name": "SEA BREEZE  ", "Valid": True})) is None
    assert vessel.normalize_aisstream(_report(mmsi, part_b={
        "ShipType": 37, "CallSign": "WDK1234", "Dimension": {"A": 8, "B": 4, "C": 2, "D": 1}, "Valid": True})) is None
    entity = vessel.normalize_aisstream(_position(mmsi))
    ident = entity["identity"]
    assert ident["ship_name"] == "SEA BREEZE" and entity["display_name"] == "SEA BREEZE"
    assert ident["ship_type"] == "Pleasure Craft" and ident["ship_type_code"] == 37
    assert ident["ship_category"] == "recreational"
    assert ident["callsign"] == "WDK1234" and ident["length_m"] == 12 and ident["width_m"] == 3


def test_parts_merge_in_either_order_and_do_not_erase_message_5_fields():
    mmsi = "367000002"
    vessel.normalize_aisstream({"MessageType": "ShipStaticData", "MetaData": {"MMSI": int(mmsi)},
                                "Message": {"ShipStaticData": {"Type": 70, "Destination": "PORTLAND"}}})
    vessel.normalize_aisstream(_report(mmsi, part_a={"Name": "BARGE ONE"}))
    ident = vessel.normalize_aisstream(_position(mmsi))["identity"]
    assert ident["ship_type"] == "Cargo" and ident["ship_category"] == "cargo"
    assert ident["destination"] == "PORTLAND" and ident["ship_name"] == "BARGE ONE"


def test_unusable_reports_are_ignored():
    mmsi = "367000003"
    for report in ({"ReportB": {"ShipType": 0}}, {"ReportB": {"ShipType": True}}, {"ReportB": "x"}, {}, None):
        msg = {"MessageType": "StaticDataReport", "MetaData": {"MMSI": int(mmsi)}, "Message": {"StaticDataReport": report}}
        assert vessel.normalize_aisstream(msg) is None
    assert "ship_type" not in vessel.normalize_aisstream(_position(mmsi))["identity"]


def test_message_5_now_records_the_category_bucket():
    mmsi = "367000004"
    vessel.normalize_aisstream({"MessageType": "ShipStaticData", "MetaData": {"MMSI": int(mmsi)},
                                "Message": {"ShipStaticData": {"Type": 52}}})
    assert vessel.normalize_aisstream(_position(mmsi))["identity"]["ship_category"] == "tug"


def test_seeding_restores_stored_static_data_without_overriding_live_data():
    vessel.normalize_aisstream({"MessageType": "ShipStaticData", "MetaData": {"MMSI": 367000010},
                                "Message": {"ShipStaticData": {"Type": 80}}})        # heard live this run: tanker
    stored = [
        ("367000010", {"ship_type_code": 70, "ship_type": "Cargo", "ship_name": "OLD"}),   # stale copy loses to live
        ("367000011", {"ship_type_code": 52, "ship_type": "Tug", "length_m": 30, "ship_name": "TUGGER"}),
        ("367000012", {"ship_name": "NO TYPE"}),                                           # nothing to restore
        ("", {"ship_type_code": 70}), ("367000013", "not a dict"),
    ]
    assert vessel.seed_static_cache(stored) == 2
    live = vessel.normalize_aisstream(_position("367000010"))["identity"]
    assert live["ship_type"] == "Tanker" and live["ship_category"] == "tanker"
    seeded = vessel.normalize_aisstream(_position("367000011"))["identity"]
    assert seeded["ship_category"] == "tug" and seeded["length_m"] == 30 and seeded["ship_name"] == "TUGGER"
    assert "ship_type" not in vessel.normalize_aisstream(_position("367000012"))["identity"]
