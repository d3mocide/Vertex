"""Tests for runtime region configuration and the NWS location resolver.

Run from backend/:
    pytest tests/test_region_config.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from types import SimpleNamespace

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

import httpx
import pytest

import capabilities as cap
import nws_resolver
import region_config as rc


def _settings(fields_set=(), **kw):
    base = dict(region_name="Default", region_lat=45.0, region_lon=-122.0, region_timezone="America/Los_Angeles",
                bbox_min_lat=44.0, bbox_max_lat=46.0, bbox_min_lon=-123.0, bbox_max_lon=-121.0, odot_api_key="")
    base.update(kw)
    return SimpleNamespace(model_fields_set=set(fields_set), **base)


STORED = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver",
          "bbox": {"min_lat": 39.2, "max_lat": 40.3, "min_lon": -105.7, "max_lon": -104.3},
          "nws": {"office": "BOU", "forecast_zone": "COZ039"}}


# ── precedence ───────────────────────────────────────────────────────────────
def test_defaults_when_nothing_is_set():
    r = rc.effective(_settings(), None)
    assert r["source"] == "default" and r["configured"] is False and r["locked"] is False
    assert r["center"] == [45.0, -122.0]


def test_database_value_is_used_when_env_does_not_pin_the_region():
    r = rc.effective(_settings(), STORED, "2026-09-29T00:00:00+00:00")
    assert r["source"] == "database" and r["center"] == [39.74, -104.99] and r["name"] == "Denver, CO"
    assert r["timezone"] == "America/Denver" and r["nws"]["office"] == "BOU" and r["updated_at"]


def test_env_wins_over_database_and_locks_the_region():
    r = rc.effective(_settings(fields_set={"region_lat", "region_lon"}), STORED)
    assert r["source"] == "env" and r["locked"] is True and r["center"] == [45.0, -122.0]
    assert r["locked_by"] == ["REGION_LAT", "REGION_LON"] and r["updated_at"] is None


def test_env_lock_is_reported_per_variable():
    assert rc.env_locked_by(_settings(fields_set={"region_lat"})) == ["REGION_LAT"]
    assert rc.env_locked_by(_settings()) == []


# ── validation ───────────────────────────────────────────────────────────────
def _payload(**kw):
    p = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver"}
    p.update(kw)
    return p


def test_normalize_builds_a_bbox_from_the_default_radius():
    out = rc.normalize(_payload())
    b = out["bbox"]
    assert b["min_lat"] < 39.74 < b["max_lat"] and b["min_lon"] < -104.99 < b["max_lon"]
    assert round(b["max_lat"] - b["min_lat"], 2) == round(2 * rc.DEFAULT_RADIUS_KM / 111.0, 2)


def test_longitude_span_widens_with_latitude():
    low = rc.bbox_from_radius(10, 0, 50)
    high = rc.bbox_from_radius(60, 0, 50)
    assert (high["max_lon"] - high["min_lon"]) > (low["max_lon"] - low["min_lon"])


def test_normalize_accepts_an_explicit_bbox_and_nws_ids():
    out = rc.normalize(_payload(bbox=STORED["bbox"], nws={"office": "BOU", "junk": "x"}))
    assert out["bbox"] == STORED["bbox"] and out["nws"] == {"office": "BOU"}


@pytest.mark.parametrize("bad", [
    _payload(lat=91), _payload(lon=-181), _payload(name=""), _payload(name="x" * 65),
    _payload(timezone="Mars/Olympus"), _payload(timezone=""), _payload(radius_km=1), _payload(radius_km=9999),
    _payload(bbox={"min_lat": 40, "max_lat": 39, "min_lon": -105, "max_lon": -104}),
    _payload(bbox={"min_lat": 10, "max_lat": 11, "min_lon": 10, "max_lon": 11}),  # center outside the box
])
def test_normalize_rejects_bad_input(bad):
    with pytest.raises(rc.RegionError):
        rc.normalize(bad)


def test_normalize_requires_a_center():
    with pytest.raises(rc.RegionError):
        rc.normalize({"name": "x", "timezone": "America/Denver"})


# ── NWS resolver ─────────────────────────────────────────────────────────────
NWS_OK = {"properties": {
    "gridId": "BOU", "timeZone": "America/Denver",
    "forecastZone": "https://api.weather.gov/zones/forecast/COZ039",
    "county": "https://api.weather.gov/zones/county/COC031",
    "fireWeatherZone": "https://api.weather.gov/zones/fire/COZ239",
    "relativeLocation": {"properties": {"city": "Denver", "state": "CO"}}}}


def _resolve(handler, lat=39.74, lon=-104.99):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await nws_resolver.resolve(lat, lon, client)
    return asyncio.run(run())


def test_resolver_extracts_office_zones_timezone_and_name():
    seen = {}
    def handler(req):
        seen["url"] = str(req.url)
        return httpx.Response(200, json=NWS_OK)
    out = _resolve(handler)
    assert seen["url"].endswith("/points/39.7400,-104.9900")
    assert out["office"] == "BOU" and out["forecast_zone"] == "COZ039" and out["county_zone"] == "COC031"
    assert out["fire_zone"] == "COZ239" and out["timezone"] == "America/Denver"
    assert out["suggested_name"] == "Denver, CO" and out["suggested_bbox"]["min_lat"] < 39.74


def test_resolver_reports_no_coverage_outside_the_us():
    with pytest.raises(nws_resolver.ResolveError, match="US only"):
        _resolve(lambda req: httpx.Response(404, json={}), lat=51.5, lon=-0.12)


def test_resolver_reports_upstream_failure():
    with pytest.raises(nws_resolver.ResolveError, match="500"):
        _resolve(lambda req: httpx.Response(500))


# ── capabilities follows the effective region ────────────────────────────────
def test_capabilities_uses_the_effective_region_for_coverage():
    denver = rc.effective(_settings(), STORED)
    out = cap.build(_settings(), {}, denver)
    assert out["region"]["name"] == "Denver, CO"
    assert out["contracts"]["outages.areas"]["reason"] == "outside_coverage"
    portland = rc.effective(_settings(), {**STORED, "lat": 45.5, "lon": -122.7})
    assert cap.build(_settings(), {}, portland)["contracts"]["outages.areas"]["status"] == "pending"
