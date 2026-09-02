"""Regression test for write_entity_observation's use of bus._entity_cache.

bus._entity_cache stores entity_id -> (timestamp, entity_dict) tuples (see
bus.py). write_entity_observation previously read the cached value directly
as if it were the entity dict, causing:

    AttributeError: 'tuple' object has no attribute 'get'

on any high-frequency entity update that landed inside the rate-limit window
(the common case for BEAST-fed aircraft). This test exercises that code path
with a populated cache entry to guard against regressing the fix.

Run from poller/:
    pytest tests/test_db_entity_cache.py
"""
from __future__ import annotations

import os
import sys
import time
from unittest.mock import MagicMock

import pytest

_mock_settings = MagicMock()
_mock_settings.adsb_history_mode = "record"

for _mod in ("redis", "redis.asyncio", "config"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["config"].settings = _mock_settings
# geofence.py has no heavy deps (just sanitize + stdlib) so it's imported for
# real rather than stubbed — stubbing it via sys.modules would leak into
# test_geofence.py, which imports the real module under the same test run.

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

sys.modules.pop("bus", None)
sys.modules.pop("db", None)

import bus  # noqa: E402
import db  # noqa: E402


class _FakeConn:
    async def execute(self, *args, **kwargs):
        return "INSERT 0 1"


class _FakeAcquireCtx:
    async def __aenter__(self):
        return _FakeConn()

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def acquire(self):
        return _FakeAcquireCtx()


@pytest.fixture(autouse=True)
def _reset_state():
    bus._entity_cache.clear()
    db._last_entity_write_ts.clear()
    db._last_obs_ts.clear()
    db._pool = _FakePool()
    yield
    db._pool = None


@pytest.mark.asyncio
async def test_write_entity_observation_handles_tuple_cache_entry():
    entity_id = "aircraft:test001"
    prev_entity = {
        "entity_id": entity_id,
        "entity_type": "aircraft",
        "source": "adsb",
        "display_name": "N12345",
        "identity": {"callsign": "N12345"},
    }
    # Mirrors bus.publish_entity: cache stores (monotonic_ts, entity_dict).
    bus._entity_cache[entity_id] = (time.monotonic(), prev_entity)
    # Recent write so we hit the "compare against cached prev" branch instead
    # of the unconditional should_write_entity=True fast path.
    db._last_entity_write_ts[entity_id] = time.time()

    new_entity = dict(prev_entity, display_name="N12345 (changed)")

    # Previously raised AttributeError: 'tuple' object has no attribute 'get'
    await db.write_entity_observation(new_entity, record_observation=False, sanitized=True)
