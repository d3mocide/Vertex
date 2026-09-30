"""Tests for following the region stored in the database.

Run from poller/:
    pytest tests/test_region_sync.py
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import region_sync as rs

STORED = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver",
          "bbox": {"min_lat": 39.2, "max_lat": 40.3, "min_lon": -105.7, "max_lon": -104.3},
          "nws": {"office": "BOU"}}


class FakePool:
    """Stands in for the asyncpg pool: returns whatever row it currently holds."""
    def __init__(self, value=None, updated_at=None, error=None):
        self.value, self.updated_at, self.error = value, updated_at, error

    async def fetchrow(self, query, key):
        if self.error:
            raise self.error
        if self.value is None:
            return None
        return {"value": json.dumps(self.value), "updated_at": self.updated_at}


def _settings(fields_set=()):
    return SimpleNamespace(
        model_fields_set=set(fields_set), region_lat=45.0, region_lon=-122.0, region_name="Default",
        region_timezone="America/Los_Angeles", bbox_min_lat=44.0, bbox_max_lat=46.0, bbox_min_lon=-123.0,
        bbox_max_lon=-121.0, nws_office="PQR")


T0 = datetime(2026, 9, 29, tzinfo=timezone.utc)


def test_stored_region_is_applied_when_env_does_not_pin_it():
    s = _settings()
    sig = asyncio.run(rs.apply_stored_region(FakePool(STORED, T0), s))
    assert sig and s.region_lat == 39.74 and s.region_lon == -104.99 and s.region_name == "Denver, CO"
    assert s.region_timezone == "America/Denver" and s.bbox_min_lat == 39.2 and s.bbox_max_lon == -104.3
    assert s.nws_office == "BOU"


def test_env_pinned_region_is_left_alone():
    s = _settings(fields_set={"region_lat", "region_lon"})
    assert asyncio.run(rs.apply_stored_region(FakePool(STORED, T0), s)) is None
    assert s.region_lat == 45.0 and s.nws_office == "PQR"


def test_explicit_nws_office_in_env_is_not_overridden():
    s = _settings(fields_set={"nws_office"})
    asyncio.run(rs.apply_stored_region(FakePool(STORED, T0), s))
    assert s.nws_office == "PQR" and s.region_lat == 39.74


def test_nothing_stored_or_table_missing_keeps_defaults():
    for pool in (FakePool(None), FakePool(error=RuntimeError('relation "app_settings" does not exist'))):
        s = _settings()
        assert asyncio.run(rs.apply_stored_region(pool, s)) is None
        assert s.region_lat == 45.0


def test_signature_changes_when_the_region_changes():
    a = asyncio.run(rs._read_stored(FakePool(STORED, T0)))[1]
    b = asyncio.run(rs._read_stored(FakePool({**STORED, "lat": 40.0}, T0)))[1]
    assert a != b


def _watch(pool, applied, settings):
    """Run one check cycle of the watcher; returns whether it asked the process to restart."""
    async def run():
        calls = {"n": 0}
        async def fake_sleep(_):
            calls["n"] += 1
            if calls["n"] > 1:
                raise asyncio.CancelledError
        with patch.object(rs.asyncio, "sleep", fake_sleep), patch.object(rs.os, "kill") as kill:
            try:
                await rs.watch_region(pool, settings, applied)
            except asyncio.CancelledError:
                pass
            return kill
    return asyncio.run(run())


def test_watcher_restarts_the_process_when_the_region_changes():
    applied = asyncio.run(rs._read_stored(FakePool(STORED, T0)))[1]
    kill = _watch(FakePool({**STORED, "lat": 41.0}, T0), applied, _settings())
    kill.assert_called_once_with(os.getpid(), signal.SIGTERM)


def test_watcher_restarts_when_a_region_is_first_saved():
    kill = _watch(FakePool(STORED, T0), None, _settings())
    kill.assert_called_once()


def test_watcher_stays_quiet_when_nothing_changed_or_env_pins_the_region():
    applied = asyncio.run(rs._read_stored(FakePool(STORED, T0)))[1]
    assert not _watch(FakePool(STORED, T0), applied, _settings()).called
    assert not _watch(FakePool({**STORED, "lat": 41.0}, T0), applied, _settings({"region_lat"})).called
