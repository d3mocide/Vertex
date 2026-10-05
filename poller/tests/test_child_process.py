"""Tests for running heavy work in a child process (child_process.py) and the baseline job built on it."""
from __future__ import annotations

import asyncio
import math
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from child_process import run_in_child
from incident_baseline import compute_baseline


def test_work_runs_in_another_process_and_returns_its_result():
    assert asyncio.run(run_in_child(math.factorial, 6)) == 720
    assert asyncio.run(run_in_child(os.getpid)) != os.getpid()


def test_baseline_job_is_picklable_end_to_end():
    now = datetime(2026, 10, 5, 15, 30, tzinfo=timezone.utc)
    rows = [(now - timedelta(days=d, hours=2), 1, "WC Fire Disp",
             "engine 1 respond to a structure fire at 200 southwest main street") for d in range(1, 8)]
    report = asyncio.run(run_in_child(compute_baseline, rows, (), now, now - timedelta(days=10), 14))
    assert report["baseline_days"] >= 5 and "structure_fire" in report["categories"]


def test_rail_refresh_is_skipped_while_the_cache_is_fresh_and_runs_when_stale(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from pollers import rail_infrastructure as rail

    poller = rail.RailInfrastructurePoller()
    box = SimpleNamespace(min_lat=44.8, max_lat=45.9, min_lon=-123.5, max_lon=-121.8)
    monkeypatch.setattr(rail, "settings", SimpleNamespace(regions=[SimpleNamespace(bbox=box)]))
    job = AsyncMock(return_value=('{"type":"FeatureCollection","features":[]}', 0))
    monkeypatch.setattr(rail, "run_in_child", job)

    def bus(ttl):
        return SimpleNamespace(ttl=AsyncMock(return_value=ttl), set=AsyncMock())

    fresh = bus(rail._CACHE_TTL_S + 3600 - 3600)         # fetched an hour ago
    monkeypatch.setattr(rail, "get_bus", AsyncMock(return_value=fresh))
    asyncio.run(poller.poll())
    job.assert_not_awaited()

    stale = bus(rail._CACHE_TTL_S + 3600 - 13 * 3600)    # thirteen hours old
    monkeypatch.setattr(rail, "get_bus", AsyncMock(return_value=stale))
    asyncio.run(poller.poll())
    job.assert_awaited_once()
    stale.set.assert_awaited_once()
    missing = bus(-2)                                    # no cache at all
    monkeypatch.setattr(rail, "get_bus", AsyncMock(return_value=missing))
    asyncio.run(poller.poll())
    assert job.await_count == 2
