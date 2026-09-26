"""Tests for the in-memory geofence state machine (entry/exit/dwell logic).

The geofence module uses an in-process dict `_entity_state` to track which
entities are currently inside which fences.  These tests exercise the state
transitions without touching Postgres — DB calls are replaced with async fakes.

Run from poller/:
    pytest tests/test_geofence.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

# Stub Redis bus before importing geofence
for _mod in ["bus", "config", "db"]:
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["bus"].get_bus = AsyncMock()

import geofence as gf  # noqa: E402  (must come after stubs)


def _entity(entity_id: str = "aircraft:abc123", lat: float = 45.5, lon: float = -122.3) -> dict:
    return {"entity_id": entity_id, "lat": lat, "lon": lon, "display_name": "TEST"}


def _fence_row(fence_id: int = 1, name: str = "TestZone", zone_type: str = "alert", dwell_seconds: int = 0) -> dict:
    return {
        "id": fence_id,
        "name": name,
        "zone_type": zone_type,
        "geofence_shape": "polygon",
        "dwell_seconds": dwell_seconds,
    }


def _make_conn(inside_rows: list[dict], exited_rows: list[dict] | None = None) -> AsyncMock:
    """Return a fake asyncpg connection whose fetch returns the given rows."""
    conn = AsyncMock()
    fetch_results = [inside_rows]
    if exited_rows is not None:
        fetch_results.append(exited_rows)
    conn.fetch.side_effect = fetch_results
    conn.execute = AsyncMock()
    return conn


def run(coro):
    return asyncio.run(coro)


class TestGeofenceStateTransitions:
    def setup_method(self):
        gf._entity_state.clear()
        gf._last_geofence_check.clear()
        gf._entity_last_seen.clear()
        gf._last_eviction = 0.0
        self._original_check_interval = gf._GEOFENCE_CHECK_INTERVAL
        # Keep unit tests focused on transition logic, not query throttling.
        gf._GEOFENCE_CHECK_INTERVAL = 0.0

    def teardown_method(self):
        gf._GEOFENCE_CHECK_INTERVAL = self._original_check_interval

    def test_first_observation_initializes_silently(self):
        conn = _make_conn([_fence_row()])
        run(gf.check_geofences(_entity(), conn))
        state = gf._entity_state.get("aircraft:abc123")
        assert state is not None
        assert 1 in state
        assert state[1]["entry_emitted"] is True  # silent init

    def test_second_observation_from_outside_triggers_no_event(self):
        run(gf.check_geofences(_entity(), _make_conn([])))  # initialize outside
        conn = _make_conn([])
        run(gf.check_geofences(_entity(), conn))
        conn.execute.assert_not_called()

    def test_entry_event_emitted_on_first_inside_after_outside(self):
        run(gf.check_geofences(_entity(), _make_conn([])))
        bus_mock = AsyncMock()
        bus_mock.publish = AsyncMock()
        sys.modules["bus"].get_bus = AsyncMock(return_value=bus_mock)

        conn = _make_conn([_fence_row(dwell_seconds=0)])
        run(gf.check_geofences(_entity(), conn))
        conn.execute.assert_called()

    def test_dwell_not_met_suppresses_entry(self):
        run(gf.check_geofences(_entity(), _make_conn([])))
        bus_mock = AsyncMock()
        sys.modules["bus"].get_bus = AsyncMock(return_value=bus_mock)

        conn = _make_conn([_fence_row(dwell_seconds=300)])
        run(gf.check_geofences(_entity(), conn))
        conn.execute.assert_not_called()

    def test_dwell_met_emits_entry(self):
        entity_id = "aircraft:abc123"
        run(gf.check_geofences(_entity(), _make_conn([])))
        gf._entity_state[entity_id] = {
            1: {
                "entered_at": datetime.now(timezone.utc) - timedelta(seconds=400),
                "entry_emitted": False,
            }
        }
        bus_mock = AsyncMock()
        bus_mock.publish = AsyncMock()
        sys.modules["bus"].get_bus = AsyncMock(return_value=bus_mock)

        conn = _make_conn([_fence_row(dwell_seconds=300)], exited_rows=[])
        run(gf.check_geofences(_entity(), conn))
        conn.execute.assert_called()

    def test_exit_clears_state(self):
        entity_id = "aircraft:abc123"
        run(gf.check_geofences(_entity(), _make_conn([_fence_row()])))
        assert 1 in gf._entity_state[entity_id]

        fence = _fence_row()
        bus_mock = AsyncMock()
        bus_mock.publish = AsyncMock()
        sys.modules["bus"].get_bus = AsyncMock(return_value=bus_mock)

        conn = _make_conn([], exited_rows=[fence])
        run(gf.check_geofences(_entity(), conn))
        assert 1 not in gf._entity_state.get(entity_id, {})

    def test_multiple_entities_isolated(self):
        e1 = _entity("aircraft:aaa")
        e2 = _entity("aircraft:bbb")
        run(gf.check_geofences(e1, _make_conn([])))
        run(gf.check_geofences(e2, _make_conn([])))
        assert "aircraft:aaa" in gf._entity_state
        assert "aircraft:bbb" in gf._entity_state
        assert gf._entity_state["aircraft:aaa"] is not gf._entity_state["aircraft:bbb"]


class TestEvictionRegression:
    """Entities outside every fence must keep their state, or their next entry
    is treated as a first observation and silently seeded (no entry event)."""

    def setup_method(self):
        gf._entity_state.clear()
        gf._last_geofence_check.clear()
        gf._entity_last_seen.clear()
        gf._last_eviction = 0.0

    def _check(self, conn, entity_id="gtfs:trimet:210"):
        gf._last_geofence_check.pop(entity_id, None)  # bypass the 30 s rate limit
        run(gf.check_geofences(_entity(entity_id), conn))

    def _event_types(self, conn):
        return [c.args[2] for c in conn.execute.call_args_list]

    def test_entry_is_emitted_after_being_outside(self):
        self._check(_make_conn([]))                   # first sight, outside: seeded silently
        conn = _make_conn([_fence_row()])
        self._check(conn)                            # enters
        assert self._event_types(conn) == ["geofence_entry"]

    def test_repeated_crossings_produce_paired_events(self):
        events = []
        self._check(_make_conn([]))
        for _ in range(3):
            c_in = _make_conn([_fence_row()])
            self._check(c_in)
            c_out = _make_conn([], exited_rows=[_fence_row()])
            self._check(c_out)
            events += self._event_types(c_in) + self._event_types(c_out)
        assert events == ["geofence_entry", "geofence_exit"] * 3

    def test_unseen_entities_are_evicted_by_last_seen(self):
        self._check(_make_conn([]), "aircraft:old")
        gf._entity_last_seen["aircraft:old"] -= gf._EVICT_AFTER_S + 1
        gf._last_eviction = 0.0
        self._check(_make_conn([]), "aircraft:new")
        assert "aircraft:old" not in gf._entity_state
        assert "aircraft:new" in gf._entity_state
