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
