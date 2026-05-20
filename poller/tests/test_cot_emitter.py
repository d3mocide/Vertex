"""Tests for cot_emitter.py — XML builder functions and scaling logic.

Run from poller/:
    pytest tests/test_cot_emitter.py
"""
import os
import sys
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Stub external dependencies before importing cot_emitter so the module loads
# cleanly in a plain Python environment.
# ---------------------------------------------------------------------------
_mock_settings = MagicMock()
_mock_settings.cot_stale_seconds = 300

for _mod in ("redis", "redis.asyncio", "config", "db", "bus"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["config"].settings = _mock_settings

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

# Force load the real cot_emitter module
sys.modules.pop("pollers.cot_emitter", None)
sys.modules.pop("cot_emitter", None)

from pollers.cot_emitter import _build_cot, _build_annotation_cot  # noqa: E402


def test_build_cot_uid_resolution():
    # Test prefer entity_id over id, default to unknown
    e1 = {"lat": 45.0, "lon": -122.0, "entity_id": "test-123"}
    xml1 = _build_cot(e1)
    assert 'uid="VERTEX-test-123"' in xml1

    e2 = {"lat": 45.0, "lon": -122.0, "id": "test-456"}
    xml2 = _build_cot(e2)
    assert 'uid="VERTEX-test-456"' in xml2

    e3 = {"lat": 45.0, "lon": -122.0}
    xml3 = _build_cot(e3)
    assert 'uid="VERTEX-unknown"' in xml3


def test_build_cot_altitude_scaling():
    # Aircraft converts feet to meters
    e_air = {"lat": 45.0, "lon": -122.0, "entity_type": "aircraft", "altitude": 10000}
    xml_air = _build_cot(e_air)
    # 10000 feet * 0.3048 = 3048.0 meters
    assert 'hae="3048.0"' in xml_air

    # Non-aircraft uses altitude_m, alt_m, or altitude directly
    e_vessel = {"lat": 45.0, "lon": -122.0, "entity_type": "vessel", "altitude_m": 50.0}
    xml_vessel = _build_cot(e_vessel)
    assert 'hae="50.0"' in xml_vessel


def test_build_cot_speed_scaling():
    # Aircraft converts knots to m/s
    e_air = {"lat": 45.0, "lon": -122.0, "entity_type": "aircraft", "speed": 100}
    xml_air = _build_cot(e_air)
    # 100 knots * 0.514444 = 51.44 m/s (rendered as 51.44)
    assert 'speed="51.44"' in xml_air

    # Vessel converts knots to m/s
    e_vessel = {"lat": 45.0, "lon": -122.0, "entity_type": "vessel", "speed": 10}
    xml_vessel = _build_cot(e_vessel)
    # 10 knots * 0.514444 = 5.14 m/s (rendered as 5.14)
    assert 'speed="5.14"' in xml_vessel

    # Others use speed_ms or speed directly (no knots conversion)
    e_other = {"lat": 45.0, "lon": -122.0, "entity_type": "aprs", "speed_ms": 15.5}
    xml_other = _build_cot(e_other)
    assert 'speed="15.50"' in xml_other


def test_build_cot_timestamps():
    from unittest.mock import patch
    from datetime import datetime, timezone

    fixed_now = datetime(2026, 5, 20, 12, 0, 0, tzinfo=timezone.utc)

    with patch("pollers.cot_emitter.datetime") as mock_datetime:
        mock_datetime.now.return_value = fixed_now
        mock_datetime.fromisoformat.side_effect = datetime.fromisoformat

        # Use last_seen if available
        e = {"lat": 45.0, "lon": -122.0, "last_seen": "2026-05-19T20:00:00Z"}
        xml = _build_cot(e)

        # 'time' should be derived from last_seen
        assert 'time="2026-05-19T20:00:00.00Z"' in xml
        # 'start' and 'stale' should be derived from the current time (mocked as fixed_now)
        assert 'start="2026-05-20T12:00:00.00Z"' in xml
        # settings.cot_stale_seconds is mocked to 300 (5 mins) in this test environment
        assert 'stale="2026-05-20T12:05:00.00Z"' in xml

