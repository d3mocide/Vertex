"""Tests for following the region chosen in the setup wizard.

Run from poller/:
    pytest tests/test_region_sync.py
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

import region_sync as rs

STORED = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver",
          "bbox": {"min_lat": 39.2, "max_lat": 40.3, "min_lon": -105.7, "max_lon": -104.3},
          "nws": {"office": "BOU"}}
# Shared with backend/tests/test_region_config.py: both sides must fingerprint a region identically.
STORED_SIGNATURE = "68d749c25f8b47d8"


class FakePool:
    """Stands in for the asyncpg pool: returns whatever row it currently holds."""
    def __init__(self, value=None, error=None):
        self.value, self.error = value, error

    async def fetchrow(self, query, key):
        if self.error:
            raise self.error
        return None if self.value is None else {"value": json.dumps(self.value)}


class FakeRedis:
    def __init__(self):
        self.states = []

    async def hset(self, key, mapping):
        assert key == rs.STATE_KEY
        self.states.append(dict(mapping))


def _settings(fields_set=(), setup_gate=True):
    return SimpleNamespace(
        model_fields_set=set(fields_set), setup_gate=setup_gate, region_lat=45.0, region_lon=-122.0,
        region_name="Default", region_timezone="America/Los_Angeles", bbox_min_lat=44.0, bbox_max_lat=46.0,
        bbox_min_lon=-123.0, bbox_max_lon=-121.0, nws_office="PQR")


async def _no_sleep(_):
    return None


def test_signature_matches_the_backend_fingerprint():
    assert rs.signature(STORED) == STORED_SIGNATURE
    assert rs.signature({**STORED, "lat": 40.0}) != STORED_SIGNATURE


def test_stored_region_is_applied_and_published():
    s, r = _settings(), FakeRedis()
    assert asyncio.run(rs.apply_or_wait(FakePool(STORED), s, r, sleep=_no_sleep)) == "database"
    assert (s.region_lat, s.region_lon, s.region_name) == (39.74, -104.99, "Denver, CO")
    assert s.region_timezone == "America/Denver" and s.bbox_min_lat == 39.2 and s.bbox_max_lon == -104.3
    assert s.nws_office == "BOU"
    assert r.states[-1] == {"state": "applied", "signature": STORED_SIGNATURE, "name": "Denver, CO"}


def test_env_pinned_region_is_left_alone_and_never_waits():
    s, r = _settings(fields_set={"region_lat", "region_lon"}), FakeRedis()
    assert asyncio.run(rs.apply_or_wait(FakePool(STORED), s, r, sleep=_no_sleep)) == "env"
    assert s.region_lat == 45.0 and s.nws_office == "PQR" and r.states[-1]["state"] == "env"


def test_explicit_nws_office_in_env_is_not_overridden():
    s = _settings(fields_set={"nws_office"})
    asyncio.run(rs.apply_or_wait(FakePool(STORED), s, FakeRedis(), sleep=_no_sleep))
    assert s.nws_office == "PQR" and s.region_lat == 39.74


def test_fresh_install_waits_for_the_wizard_then_proceeds():
    pool, s, r = FakePool(None), _settings(), FakeRedis()
    naps = {"n": 0}

    async def sleep(_):
        naps["n"] += 1
        if naps["n"] == 3:           # the operator finishes the wizard
            pool.value = STORED

    assert asyncio.run(rs.apply_or_wait(pool, s, r, sleep=sleep)) == "database"
    assert naps["n"] == 3 and s.region_name == "Denver, CO"
    assert [x["state"] for x in r.states] == ["waiting", "waiting", "waiting", "applied"]


def test_table_not_created_yet_counts_as_not_configured():
    pool, s = FakePool(error=RuntimeError('relation "app_settings" does not exist')), _settings(setup_gate=False)
    assert asyncio.run(rs.apply_or_wait(pool, s, FakeRedis(), sleep=_no_sleep)) == "default"
    assert s.region_lat == 45.0


def test_gate_off_uses_the_built_in_defaults_immediately():
    s, r = _settings(setup_gate=False), FakeRedis()
    assert asyncio.run(rs.apply_or_wait(FakePool(None), s, r, sleep=_no_sleep)) == "default"
    assert r.states[-1]["state"] == "default"


def test_works_without_redis():
    s = _settings()
    assert asyncio.run(rs.apply_or_wait(FakePool(STORED), s, None, sleep=_no_sleep)) == "database"
