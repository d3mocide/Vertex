from datetime import datetime, timezone
from types import SimpleNamespace as N

from pollers import wzdx

REGION = N(region_lat=45.5, region_lon=-122.7, bbox_min_lat=45.0, bbox_max_lat=46.0, bbox_min_lon=-123.2, bbox_max_lon=-122.0)
NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)
SPEC = {"link": "https://dot.example.org/map", "attribution": "Example DOT"}


def zone(ident="z1", impact="all-lanes-closed", status="active", start="2026-10-20T00:00:00Z", end="2026-10-30T00:00:00Z",
         geometry=None, event="work-zone", road="I-5", direction="northbound", description="Bridge repair."):
    return {"type": "Feature", "id": ident,
            "geometry": geometry or {"type": "LineString", "coordinates": [[-122.70, 45.50], [-122.69, 45.51]]},
            "properties": {"core_details": {"event_type": event, "road_names": [road], "direction": direction,
                                            "description": description, "update_date": "2026-10-21T10:00:00Z"},
                           "start_date": start, "end_date": end, "event_status": status, "vehicle_impact": impact}}


def run(*features, now=NOW):
    return wzdx.normalize(list(features), SPEC, REGION, "example-wz", now=now)


def test_a_closed_work_zone_becomes_a_closure_incident_that_is_never_unplanned():
    [item] = run(zone())
    assert item["id"] == "example-wz:z1" and item["title"] == "Work zone: I-5 northbound"
    assert item["kind"] == "closure" and item["scope"] == "road" and item["unplanned"] is False
    assert item["severity"] == "Closure: all lanes closed" and item["link"] == "https://dot.example.org/map"
    assert item["start"].startswith("2026-10-20") and item["sched_end"].startswith("2026-10-30")
    assert item["lat"] == 45.5 and item["lon"] == -122.7 and item["dist_km"] < 1       # the vertex nearest the region centre


def test_lane_impact_decides_what_is_listed():
    assert run(zone(impact="all-lanes-open")) == []                                   # the agency says traffic is unaffected
    [alternating] = run(zone(impact="alternating-one-way"))
    assert alternating["kind"] == "low" and alternating["severity"] == "Alternating one-way traffic"
    assert run(zone(impact="unknown", status="pending")) == []                         # scheduled, impact not stated
    assert len(run(zone(impact="unknown", status="active"))) == 1
    assert len(run(zone(impact=None, status="active"))) == 1                           # older feed versions omit the field


def test_finished_future_and_non_work_zone_events_are_skipped():
    assert run(zone(status="completed")) == [] and run(zone(status="cancelled")) == []
    assert run(zone(end="2026-10-21T00:00:00Z")) == []                                 # ended yesterday
    assert run(zone(start="2026-10-25T00:00:00Z", status="pending")) == []             # starts in days
    assert len(run(zone(start="2026-10-23T06:00:00Z", status="pending"))) == 1          # starts within a day
    assert run(zone(event="detour")) == []


def test_only_zones_inside_the_monitoring_area_are_kept_and_the_nearest_vertex_is_used():
    far = {"type": "LineString", "coordinates": [[-100.0, 30.0], [-100.1, 30.1]]}
    straddling = {"type": "LineString", "coordinates": [[-124.0, 45.5], [-122.5, 45.5], [-122.69, 45.5]]}
    [item] = run(zone("far", geometry=far), zone("edge", geometry=straddling))
    assert item["id"] == "example-wz:edge" and item["lon"] == -122.69


def test_odd_geometry_and_malformed_features_never_raise():
    bad = [None, 3, {}, {"properties": []}, zone("a", geometry={"type": "Polygon", "coordinates": []}),
           zone("b", geometry={"type": "Point", "coordinates": ["x", 1]}), zone("c", geometry={"type": "Point", "coordinates": [999, 999]})]
    assert run(*bad) == []
    [point] = run(zone("p", geometry={"type": "Point", "coordinates": [-122.7, 45.5]}))
    assert point["id"] == "example-wz:p"
    [multi] = run(zone("m", geometry={"type": "MultiLineString", "coordinates": [[[-122.7, 45.5], [-122.6, 45.6]]]}))
    assert multi["id"] == "example-wz:m"


def test_nearby_closures_are_grouped_like_any_other_providers_closures():
    items = run(zone("a"), zone("b", geometry={"type": "Point", "coordinates": [-122.695, 45.505]}))
    assert {i["group"] for i in items} != {None} and all(i["group_size"] == 2 for i in items) and sum(i["lead"] for i in items) == 1


def test_markup_in_the_agency_text_is_stripped():
    [item] = run(zone(description="<b>Bridge</b> repair [details](https://x.example/y)"))
    assert item["description"] == "Bridge repair details"


def test_build_pollers_makes_a_wzdx_poller_from_a_declared_provider(monkeypatch):
    import providers, provider_catalog
    spec = {**SPEC, "url": "https://dot.example.org/wzdx", "key": None, "poll_seconds": 120, "coverage": None}
    monkeypatch.setitem(provider_catalog.PROVIDERS, "example-wz", {"contracts": {"traffic.incidents": ["traffic:incidents"]},
                        "bbox": (-123.2, 45.0, -122.0, 46.0), "kind": "wzdx", "declarative": spec, "attribution": "Example DOT"})
    [poller] = providers.build_pollers({"example-wz": {"reason": None, "contracts": ["traffic.incidents"]}})
    assert isinstance(poller, wzdx.WzdxPoller) and poller.interval == 120 and poller.name == "example_wz"
