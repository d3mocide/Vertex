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
    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "45.5613", "lon": "-122.6668"}]))
    assert run(g.geocode("1221 SW 4th Ave")) == (45.5613, -122.6668)
    assert calls[0]["street"] == "1221 SW 4th Ave" and calls[0]["bounded"] == "1"
    assert calls[0]["viewbox"] == "-123.5,45.9,-121.8,44.8"
    # Second call is served from cache.
    assert run(g.geocode("1221  sw 4th ave")) == (45.5613, -122.6668)
    assert len(calls) == 1


def test_results_outside_the_operating_box_are_rejected_and_misses_cached():
    g, calls = make(lambda r: httpx.Response(200, json=[{"lat": "42.3", "lon": "-122.8"}]))
    assert run(g.geocode("100 Main St")) is None
    assert run(g.geocode("100 Main St")) is None
    assert len(calls) == 1  # the miss is cached


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
    assert calls[0]["polygon_geojson"] == "1"
    assert g_calls[0][0] == line and g_calls[0][2] == 40
