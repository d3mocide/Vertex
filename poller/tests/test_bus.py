"""Tests for bus.py — entity change detection and in-memory cache.

Run from poller/:
    pytest tests/test_bus.py

Heavy dependencies (redis, db) are stubbed out before any project imports so
this file runs without a live Redis or Postgres connection.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub external dependencies before importing bus so the module loads cleanly
# in a plain Python environment (no redis package required outside Docker).
# ---------------------------------------------------------------------------
_mock_settings = MagicMock()
_mock_settings.adsb_publish_only_changes = True

for _mod in ("redis", "redis.asyncio", "config", "db"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["config"].settings = _mock_settings

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from bus import _entity_changed, _entity_cache  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_entity() -> dict:
    return {
        "entity_id": "aircraft:aabbcc",
        "entity_type": "aircraft",
        "source": "beast",
        "lat": 45.5,
        "lon": -122.3,
        "altitude": 35000.0,
        "heading": 90.0,
        "speed": 450.0,
        "vertical_rate": 0.0,
        "status": "airborne",
        "identity": {"icao24": "aabbcc", "callsign": "UAL123"},
        "tags": ["aircraft"],
        "position_stale": False,
        "trail_pts": [[45.5, -122.3, 35000.0, 1700000000.0]],
        "comm_b": None,
        "last_seen": "2024-01-01T00:00:00+00:00",
    }


# ============================================================================
# 1. _entity_changed — pure comparison function
# ============================================================================

class TestEntityChanged:
    """_entity_changed checks a fixed set of compare_keys; changes outside that
    set must NOT trigger a re-publish (avoids churn from timestamp-only diffs).
    """

    def test_identical_entity_not_changed(self):
        e = _base_entity()
        assert not _entity_changed(e, e.copy())

    def test_lat_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["lat"] = 45.6
        assert _entity_changed(a, b)

    def test_lon_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["lon"] = -123.0
        assert _entity_changed(a, b)

    def test_altitude_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["altitude"] = 36000.0
        assert _entity_changed(a, b)

    def test_heading_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["heading"] = 180.0
        assert _entity_changed(a, b)

    def test_status_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["status"] = "on_ground"
        assert _entity_changed(a, b)

    def test_trail_pts_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["trail_pts"] = [*a["trail_pts"], [45.51, -122.31, 35000.0, 1700000001.0]]
        assert _entity_changed(a, b)

    def test_identity_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["identity"] = {**a["identity"], "callsign": "DAL456"}
        assert _entity_changed(a, b)

    def test_source_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["source"] = "opensky"
        assert _entity_changed(a, b)

    def test_position_stale_change_detected(self):
        a, b = _base_entity(), _base_entity()
        b["position_stale"] = True
        assert _entity_changed(a, b)

    def test_untracked_field_ignored(self):
        """last_seen is not in compare_keys — timestamp-only updates must not re-publish."""
        a, b = _base_entity(), _base_entity()
        b["last_seen"] = "2099-01-01T00:00:00+00:00"
        assert not _entity_changed(a, b)

    def test_unknown_extra_key_ignored(self):
        """An arbitrary new key not in compare_keys does not trigger a publish."""
        a, b = _base_entity(), _base_entity()
        b["some_new_field"] = "unexpected"
        assert not _entity_changed(a, b)


# ============================================================================
# 2. _entity_cache — module-level in-memory dict
# ============================================================================

class TestEntityCache:
    """Verify _entity_cache is a plain dict available for direct inspection."""

    def test_cache_is_dict(self):
        assert isinstance(_entity_cache, dict)

    def test_cache_stores_and_retrieves(self):
        _entity_cache["aircraft:test001"] = {"lat": 1.0}
        assert _entity_cache["aircraft:test001"] == {"lat": 1.0}
        del _entity_cache["aircraft:test001"]

    def test_cache_miss_returns_none(self):
        assert _entity_cache.get("aircraft:does_not_exist") is None
