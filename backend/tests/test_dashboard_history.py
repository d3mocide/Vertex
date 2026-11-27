"""Dashboard history: the admin activity payload slimmed to hourly series and totals a viewer may see."""
from routers.dashboard import shape_history


def test_shape_history_keeps_hourly_series_totals_and_dispatch_mix():
    hourly = list(range(24))
    activity = {"types": [
        {"entity_type": "aircraft", "seen_24h": 574, "hourly": hourly},
        {"entity_type": "radio_call", "seen_24h": 2300, "hourly": [5] * 24},
        {"entity_type": "dispatch_incident", "seen_24h": 303, "hourly": [1] * 24,
         "extra": {"categories": [["medical", 169], ["crash", 23]], "life_safety": 13}},
    ]}
    out = shape_history(activity, [{"tgid": "3553", "label": "WC AMR Disp", "calls": 638}] * 7)
    assert out["series"]["aircraft"] == hourly
    assert out["totals"] == {"aircraft": 574, "vessel": 0, "mesh_node": 0, "radio_call": 2300, "dispatch_incident": 303}
    assert out["series"]["vessel"] == [0] * 24                 # a type with no rows still draws a flat line
    assert out["dispatch_categories"] == [["medical", 169], ["crash", 23]]
    assert out["life_safety_24h"] == 13
    assert len(out["talkgroups"]) == 5


def test_shape_history_survives_an_empty_payload():
    out = shape_history({}, [])
    assert all(len(v) == 24 for v in out["series"].values())
    assert out["dispatch_categories"] == [] and out["talkgroups"] == []
