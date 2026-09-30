"""Tests for the capability registry (which regional contracts have a working provider).

Run from backend/:
    pytest tests/test_capabilities.py
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

import capabilities as cap

PORTLAND = dict(region_lat=45.5, region_lon=-122.7)
DENVER = dict(region_lat=39.7, region_lon=-105.0, bbox_min_lat=39, bbox_max_lat=40,
              bbox_min_lon=-106, bbox_max_lon=-104)


def _settings(**kw):
    base = dict(region_name="Test", region_timezone="America/Los_Angeles",
                bbox_min_lat=44.8, bbox_max_lat=45.9, bbox_min_lon=-123.5, bbox_max_lon=-121.8,
                odot_api_key="key", **PORTLAND)
    base.update(kw)
    return SimpleNamespace(**base)


def _contract(cid):
    return next(c for c in cap.CONTRACTS if c.id == cid)


def test_outage_provider_is_out_of_coverage_outside_oregon():
    r = cap.resolve(_contract("outages.areas"), _settings(**DENVER), {})
    assert r["status"] == "none" and r["reason"] == "outside_coverage" and r["providers"] == []


def test_traffic_needs_the_odot_key():
    r = cap.resolve(_contract("traffic.incidents"), _settings(odot_api_key=""), {})
    assert r["status"] == "none" and r["reason"] == "not_configured" and r["requires"] == "ODOT_API_KEY"


def test_key_value_is_never_echoed():
    r = cap.resolve(_contract("traffic.incidents"), _settings(odot_api_key="s3cret-value"), {})
    assert "s3cret-value" not in str(r)


def test_pending_when_enabled_but_no_data_yet():
    r = cap.resolve(_contract("traffic.incidents"), _settings(), {})
    assert r["status"] == "pending" and r["providers"] == ["odot-tripcheck"]


def test_ok_stale_and_down_by_age():
    c = _contract("traffic.incidents")  # stale after 600 s
    assert cap.resolve(c, _settings(), {"traffic:incidents": 30})["status"] == "ok"
    assert cap.resolve(c, _settings(), {"traffic:incidents": 601})["status"] == "stale"
    assert cap.resolve(c, _settings(), {"traffic:incidents": 600 * cap.DOWN_FACTOR + 1})["status"] == "down"


def test_freshest_feed_wins_for_multi_feed_contracts():
    c = _contract("outages.areas")
    r = cap.resolve(c, _settings(), {"utility:outages": 99999, "utility:oregon": 10})
    assert r["status"] == "ok" and r["updated_age_s"] == 10


def test_build_reports_region_and_every_contract():
    out = cap.build(_settings(), {})
    assert out["pack"] is None
    assert out["region"]["center"] == [45.5, -122.7] and out["region"]["name"] == "Test"
    assert set(out["contracts"]) == {c.id for c in cap.CONTRACTS}


def test_non_oregon_region_sees_no_regional_provider_without_a_key():
    out = cap.build(_settings(odot_api_key="", **DENVER), {})
    assert all(v["status"] == "none" for v in out["contracts"].values())


def test_every_contract_has_a_schema():
    """Keeps the registry and docs/contracts/schemas in step."""
    schemas = os.path.join(_BACKEND_ROOT, "..", "docs", "contracts", "schemas")
    if not os.path.isdir(schemas):
        import pytest
        pytest.skip("docs/ not available in this checkout")
    for c in cap.CONTRACTS:
        assert os.path.isfile(os.path.join(schemas, f"{c.id}.schema.json")), f"missing schema for {c.id}"
