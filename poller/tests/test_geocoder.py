"""Tests for the local-geocoder client (Nominatim mocked with httpx.MockTransport).

Run from poller/:
    pytest tests/test_geocoder.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from types import SimpleNamespace

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import httpx
import pytest

import geocoder as geo


class FakeRedis:
    def __init__(self):
        self.h: dict = {}

    async def hget(self, key, field):
        return self.h.get((key, field))

    async def hset(self, key, field, value):
        self.h[(key, field)] = value


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(geo, "settings", SimpleNamespace(
        geocoder_url="http://nominatim:8088/", geocoder_state="Oregon",
        bbox_min_lat=44.8, bbox_max_lat=45.9, bbox_min_lon=-123.5, bbox_max_lon=-121.8,
    ))


def make(handler, pool=None):
    calls = []

    def wrapped(request):
        if request.url.path.endswith("/reverse"):   # city lookup for a hit (not a search)
            return httpx.Response(200, json={"address": {"city": "Testville"}})
        calls.append(dict(request.url.params))
        return handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(wrapped))
    return geo.Geocoder(FakeRedis(), pool, client), calls


def run(coro):
    return asyncio.run(coro)


def test_only_addresses_and_intersections_are_geocodable():
    assert geo.is_geocodable("1221 SW 4th Ave")
    assert geo.is_geocodable("NW 9th Ave & NW Lovejoy St")
    assert not geo.is_geocodable("bridge (landmark)")
    assert not geo.is_geocodable("I-5")
    assert not geo.is_geocodable(None)


def test_hits_record_the_city_from_a_reverse_lookup():
    g, _ = make(lambda r: httpx.Response(200, json=[
        {"lat": "45.5613", "lon": "-122.6668", "address": {"house_number": "1221"}}]))
    assert run(g.lookup("1221 SW 4th Ave"))["city"] == "Testville"


def test_address_lookup_is_structured_bounded_and_cached():
    g, calls = make(lambda r: httpx.Response(200, json=[
        {"lat": "45.5613", "lon": "-122.6668", "address": {"house_number": "1221"}}]))
    assert run(g.geocode("1221 SW 4th Ave")) == (45.5613, -122.6668)
    assert calls[0]["street"] == "1221 SW 4th Ave" and calls[0]["bounded"] == "1"
    assert calls[0]["viewbox"] == "-123.5,45.9,-121.8,44.8"
    # Second call is served from cache.
    assert run(g.geocode("1221  sw 4th ave")) == (45.5613, -122.6668)
    assert len(calls) == 1


def test_results_outside_the_operating_box_are_rejected_and_misses_cached():
    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "42.3", "lon": "-122.8", "address": {"house_number": "100"}}]))
    assert run(g.geocode("100 Main St")) is None
    assert run(g.geocode("100 Main St")) is None
    assert len(calls) == 1  # the miss is cached


def test_street_fallback_without_house_number_is_a_miss():
    # Nominatim returns the whole street when the number is unknown — too imprecise to pin.
    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "45.61", "lon": "-122.70", "address": {"road": "N Portland Rd"}}]))
    assert run(g.geocode("540 N Portland Rd")) is None
    assert calls[0]["addressdetails"] == "1"


def test_cache_only_never_calls_the_service():
    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "45.5", "lon": "-122.6"}]))
    assert run(g.geocode("1221 SW 4th Ave", cache_only=True)) is None
    assert calls == []


def test_service_failure_is_not_cached_and_pauses_live_lookups():
    g, calls = make(lambda r: httpx.Response(503))
    assert run(g.geocode("1221 SW 4th Ave")) is None
    assert g.lookups >= 10**9
    assert g.redis.h == {}


def test_disabled_without_url(monkeypatch):
    monkeypatch.setattr(geo, "settings", SimpleNamespace(geocoder_url=""))
    g = geo.Geocoder(FakeRedis())
    assert not g.enabled
    assert run(g.geocode("1221 SW 4th Ave")) is None


def test_long_street_is_requeried_within_the_short_streets_extent():
    short = {"type": "LineString", "coordinates": [[-122.68, 45.52], [-122.67, 45.52]]}
    long_ = {"type": "LineString", "coordinates": [[-122.70, 45.50], [-122.60, 45.60]]}

    def handler(request):
        street = request.url.params["street"]
        if street == "N Columbia Blvd":
            return httpx.Response(200, json=[{"lat": "0", "lon": "0", "geojson": long_}] * 40)
        return httpx.Response(200, json=[{"lat": "0", "lon": "0", "geojson": short}])

    class Pool:
        async def fetchrow(self, *a):
            return {"lat": 45.52, "lon": -122.675}

    g, calls = make(handler, Pool())
    assert run(g.geocode("N Columbia Blvd & N Bank St")) == (45.52, -122.675)
    assert len(calls) == 3
    assert calls[2]["street"] == "N Columbia Blvd"
    assert calls[2]["viewbox"] == "-122.685,45.525,-122.665,45.515"


def test_intersection_uses_street_geometries_and_postgis():
    line = {"type": "LineString", "coordinates": [[-122.68, 45.52], [-122.67, 45.52]]}
    g_calls = []

    class Pool:
        async def fetchrow(self, sql, a, b, tol):
            g_calls.append((json.loads(a[0]), json.loads(b[0]), tol))
            return {"lat": 45.52, "lon": -122.675}

    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "45.52", "lon": "-122.675", "geojson": line}]), Pool())
    assert run(g.geocode("NW 9th Ave & NW Lovejoy St")) == (45.52, -122.675)
    assert [c["street"] for c in calls] == ["NW 9th Ave", "NW Lovejoy St"]
    assert calls[0]["polygon_geojson"] == "1" and calls[0]["dedupe"] == "0" and calls[0]["limit"] == "40"
    assert g_calls[0][0] == line and g_calls[0][2] == 40


def test_cross_streets_place_an_incident_whose_address_is_missing_and_are_marked_approximate():
    line = {"type": "LineString", "coordinates": [[-122.68, 45.52], [-122.67, 45.52]]}

    class Pool:
        async def fetchrow(self, sql, a, b, tol):
            return {"lat": 45.52, "lon": -122.675}

    g, _ = make(lambda r: httpx.Response(200, json=[{"lat": "45.52", "lon": "-122.675", "geojson": line}]), Pool())
    entry = run(g.lookup("NW 9th Ave & NW Lovejoy St", approx=True))
    assert entry["approx"] is True and (entry["lat"], entry["lon"]) == (45.52, -122.675)
    # The same pair looked up as a plain intersection is a separate cache entry and is not marked approximate.
    assert "approx" not in run(g.lookup("NW 9th Ave & NW Lovejoy St"))

# ── Fuzzy street-name corrections ────────────────────────────────────────────

import street_names


@pytest.mark.parametrize("name, expected", [
    ("North Clarendon Avenue", ("N", "clarendon", "Ave")),
    ("N Clariton Ave", ("N", "clariton", "Ave")),
    ("Lloyd Court Southeast", ("SE", "lloyd", "Ct")),
    ("N Mlk Junior Blvd", ("N", "martin luther king junior", "Blvd")),
    ("Broadway", None),
])
def test_parse_street(name, expected):
    assert street_names.parse_street(name) == expected


def test_fuzzy_correction_is_used_only_when_the_house_number_validates(monkeypatch):
    async def fake_suggest(pool, street, limit=3):
        return ["N Clark Ave", "N Clarendon Ave"]
    monkeypatch.setattr(street_names, "suggest", fake_suggest)

    def handler(request):
        street = request.url.params["street"]
        if street == "700 N Clarendon Ave":
            return httpx.Response(200, json=[{"lat": "45.58", "lon": "-122.72", "address": {"house_number": "700"}}])
        # Heard name and the wrong candidate: street-level fallback only (no house number).
        return httpx.Response(200, json=[{"lat": "45.0", "lon": "-122.0", "address": {}}])

    g, calls = make(handler)
    entry = run(g.lookup("700 N Clariton Ave"))
    assert (entry["lat"], entry["lon"]) == (45.58, -122.72)
    assert entry["how"] == "address_fuzzy" and entry["corrected"] == "700 N Clarendon Ave"
    assert [c["street"] for c in calls] == ["700 N Clariton Ave", "700 N Clark Ave", "700 N Clarendon Ave"]


def test_unvalidated_corrections_are_a_miss(monkeypatch):
    async def fake_suggest(pool, street, limit=3):
        return ["SE Park St"]
    monkeypatch.setattr(street_names, "suggest", fake_suggest)
    g, _ = make(lambda r: httpx.Response(200, json=[{"lat": "45.5", "lon": "-122.6", "address": {}}]))
    assert run(g.lookup("12345 SE Dark St")) is None


def test_street_variants_strip_filler_and_leading_junk():
    assert geo._street_variants("off of Western Ave") == ["Western Ave"]
    assert geo._street_variants("patrick s norville st") == ["s norville st"]
    assert geo._street_variants("SW Main St") == []


def test_name_core_ignores_direction_and_type():
    assert geo._name_core("SW Tuckerwood Ct") == "tuckerwood"
    assert geo._name_core("NE Berkshire") == "berkshire"
    assert geo._name_core("Hwy") is None


def test_street_without_direction_or_type_is_parsed_loosely():
    import street_names as sn

    assert sn.parse_loose("NE Berkshire") == ("NE", "berkshire")
    assert sn.parse_loose("NE Berkshire Dr") is None  # has a type: parse_street handles it
    assert sn.has_direction("SE Century") and not sn.has_direction("5th Ave")


@pytest.mark.asyncio
async def test_address_without_direction_needs_exactly_one_match(monkeypatch):
    import street_names as sn

    async def fake_suggest(pool, street, limit=3):
        return ["NW 5th Ave", "SW 5th Ave"]

    monkeypatch.setattr(sn, "suggest", fake_suggest)

    async def both(self, location):
        return (45.5, -122.6)

    async def only_nw(self, location):
        return (45.5, -122.6) if " NW " in location else None

    g = geo.Geocoder(FakeRedis(), pool=object())
    monkeypatch.setattr(geo.Geocoder, "_address", only_nw)
    # "100 5th Ave" itself is not found, only the NW candidate has that number.
    point, how, corrected = await g._resolve("100 5th Ave")
    assert (how, corrected) == ("address_fuzzy", "100 NW 5th Ave")

    # Two quadrants carry the number: ambiguous, so no pin.
    async def either(self, location):
        return (45.5, -122.6) if location != "100 5th Ave" else None

    monkeypatch.setattr(geo.Geocoder, "_address", either)
    assert await g._resolve("100 5th Ave") == (None, "miss", None)


def test_interpolate_between_neighbours_on_the_same_side():
    import address_points as ap

    known = [(29811, 45.100, -122.500), (29901, 45.110, -122.500), (29810, 45.1, -122.5), (29700, 45.09, -122.5)]
    assert ap.interpolate(29811, known)[2] is True
    lat, lon, exact = ap.interpolate(29819, known)
    assert not exact and 45.100 < lat < 45.110          # between 29811 and 29901 (odd side)
    assert ap.interpolate(29455, known) is None          # nothing close enough to trust


def test_interpolate_refuses_neighbours_far_apart():
    import address_points as ap

    assert ap.interpolate(150, [(100, 45.0, -122.0), (200, 45.1, -122.0)]) is None      # 11 km apart: the street bends
    assert ap.interpolate(110, [(100, 45.0, -122.0)]) is not None                        # end of the street, close number


def test_interpolate_refuses_the_same_number_in_two_towns():
    import address_points as ap
    assert ap.interpolate(100, [(100, 45.0, -122.0), (100, 45.2, -122.1)]) is None                    # 25 km apart
    lat, lon, exact = ap.interpolate(100, [(100, 45.0, -122.0), (100, 45.0001, -122.0)])             # units at one address
    assert exact is True


class FakeAddressPool:
    """Stands in for an asyncpg pool: fetch() returns canned rows, fetchval() answers by query text."""

    def __init__(self, rows=(), loaded_at=None, signature=None):
        self.rows, self.loaded_at, self.signature, self.executed = list(rows), loaded_at, signature, []

    async def fetch(self, query, *args):
        return self.rows

    async def fetchval(self, query, *args):
        return self.signature if "signature" in query else self.loaded_at

    def acquire(self):
        pool = self

        class Conn:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, query, *args):
                pool.executed.append(query)

        return Conn()


@pytest.mark.asyncio
async def test_locate_with_a_heard_direction_uses_points_that_lack_one(monkeypatch):
    import address_points as ap
    monkeypatch.setattr(ap.settings, "address_points_url", "https://example.test/arcgis/rest/services/x/FeatureServer/0")
    rows = [{"dir": "S", "num": 100, "lat": 45.0, "lon": -122.0}, {"dir": "", "num": 120, "lat": 45.002, "lon": -122.0}]
    hit = await ap.locate(FakeAddressPool(rows), "110 S Main St")
    assert hit is not None and hit[2] is False and 45.0 < hit[0] < 45.002


@pytest.mark.asyncio
async def test_a_changed_region_reloads_the_address_points(monkeypatch):
    import time
    import address_points as ap
    monkeypatch.setattr(ap.settings, "address_points_url", "https://example.test/arcgis/rest/services/x/FeatureServer/0")
    for name, value in (("bbox_min_lat", 44.8), ("bbox_min_lon", -123.5), ("bbox_max_lat", 45.8), ("bbox_max_lon", -122.0)):
        monkeypatch.setattr(ap.settings, name, value)
    loaded = []

    async def fake_pages(client):
        loaded.append(True)
        return
        yield

    monkeypatch.setattr(ap, "_pages", fake_pages)
    fresh = time.time() - 3600
    assert await ap.refresh_if_stale(FakeAddressPool(loaded_at=fresh, signature=ap._signature())) == 0 and not loaded
    await ap.refresh_if_stale(FakeAddressPool(loaded_at=fresh, signature="https://example.test|0,0,1,1"))
    assert loaded                       # same age, different box: the points are re-fetched


@pytest.mark.asyncio
async def test_address_point_pages_use_the_pinned_request_and_follow_object_ids(monkeypatch):
    import address_points as ap
    monkeypatch.setattr(ap.settings, "address_points_url", "https://example.test/arcgis/rest/services/x/FeatureServer/0/")
    sent = []

    async def fake_send(client, method, url, **kwargs):
        sent.append((method, url, kwargs["data"]["where"]))
        first = len(sent) == 1
        body = {"features": [{"attributes": {"OBJECTID": 7 if first else 9}}], "exceededTransferLimit": first}
        return httpx.Response(200, json=body, request=httpx.Request(method, url))

    monkeypatch.setattr(ap, "send_pinned_http_request", fake_send)
    monkeypatch.setattr(ap, "_PAUSE_S", 0)
    pages = [p async for p in ap._pages(None)]
    assert len(pages) == 2 and all(m == "POST" and u.endswith("/FeatureServer/0/query") for m, u, _ in sent)
    assert sent[1][2].endswith("OBJECTID > 7")
