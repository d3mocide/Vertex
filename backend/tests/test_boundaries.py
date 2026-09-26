"""Tests for geofence boundary lookup (Nominatim and Census TIGERweb mocked).

Run from backend/:
    pytest tests/test_boundaries.py
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

import boundaries as b

SQUARE = {"type": "Polygon", "coordinates": [[[-122.8, 45.35], [-122.7, 45.35], [-122.7, 45.40], [-122.8, 45.40], [-122.8, 45.35]]]}
TWO_PARTS = {"type": "MultiPolygon", "coordinates": [SQUARE["coordinates"],
             [[[-122.6, 45.35], [-122.59, 45.35], [-122.59, 45.36], [-122.6, 45.35]]]]}


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(b, "settings", SimpleNamespace(
        geocoder_url="http://nominatim:8088", geocoder_state="Oregon", boundary_zip_lookup_enabled=True))


def run_with(handler, query):
    real = httpx.AsyncClient

    class Client(real):
        def __init__(self, *a, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            super().__init__(*a, **kw)

    b.httpx.AsyncClient = Client
    try:
        return asyncio.run(b.search_boundaries(query))
    finally:
        b.httpx.AsyncClient = real


def boundary(name, osm_id, state="Oregon", geojson=SQUARE):
    return {"category": "boundary", "type": "administrative", "name": name, "osm_type": "relation",
            "osm_id": osm_id, "geojson": geojson, "address": {"state": state}}


def test_city_is_matched_by_name_and_other_states_are_dropped():
    def handler(req):
        assert req.url.params["q"] == "Washington County"  # no ", Oregon" suffix
        return httpx.Response(200, json=[
            boundary("Washington County", 1, state="Minnesota"),
            boundary("Washington County", 2),
        ])

    out = run_with(handler, "Washington County")
    assert [(c["name"], c["kind"], c["id"]) for c in out] == [("Washington County, Oregon", "county", "osm:relation:2")]


def test_multipolygon_cities_are_supported_and_area_is_reasonable():
    out = run_with(lambda req: httpx.Response(200, json=[boundary("Lake Oswego", 3, geojson=TWO_PARTS)]), "Lake Oswego")
    assert out[0]["geojson"]["type"] == "MultiPolygon"
    # ~7.8 km x 5.6 km square at this latitude
    assert 40 < out[0]["area_km2"] < 50


def test_falls_back_to_reverse_boundary_around_a_matching_place():
    def handler(req):
        if req.url.path == "/search" and "polygon_geojson" in req.url.params:
            return httpx.Response(200, json=[{"category": "highway", "name": "Main St"}])
        if req.url.path == "/search":
            return httpx.Response(200, json=[{"lat": "45.38", "lon": "-122.76"}])
        zoom = req.url.params["zoom"]
        return httpx.Response(200, json=boundary("Tualatin" if zoom == "10" else "Washington County", int(zoom)))

    out = run_with(handler, "Tualatin")
    assert [c["name"] for c in out] == ["Tualatin, Oregon", "Washington County, Oregon"]


def test_zip_uses_census_zcta_and_can_be_disabled(monkeypatch):
    def handler(req):
        assert "tigerweb.geo.census.gov" in str(req.url)
        assert req.url.params["where"] == "ZCTA5='97204'"
        return httpx.Response(200, json={"features": [{"geometry": SQUARE, "properties": {"ZCTA5": "97204"}}]})

    assert run_with(handler, "97204")[0]["name"] == "ZIP 97204"
    monkeypatch.setattr(b.settings, "boundary_zip_lookup_enabled", False)
    with pytest.raises(b.BoundaryLookupError):
        run_with(handler, "97204")


def test_city_lookup_requires_a_geocoder(monkeypatch):
    monkeypatch.setattr(b.settings, "geocoder_url", "")
    with pytest.raises(b.BoundaryLookupError):
        run_with(lambda req: httpx.Response(200, json=[]), "Tualatin")
