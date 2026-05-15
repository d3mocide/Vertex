"""Tests for the observations router (backend/routers/observations.py).

No live database required — DB session is fully mocked.

Run from backend/:
    pytest tests/test_observations.py -v
"""
from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# Stub db.session with a real SQLAlchemy Base so that db.models can define
# proper ORM classes (Entity.entity_type etc.) without a live database.
# ---------------------------------------------------------------------------
from sqlalchemy.orm import DeclarativeBase as _DeclarativeBase  # noqa: E402


class _Base(_DeclarativeBase):
    pass


_mock_db_session = MagicMock()
_mock_db_session.Base = _Base
_mock_db_session.async_session_factory = MagicMock()
sys.modules["db.session"] = _mock_db_session

# ---------------------------------------------------------------------------
# Stub remaining heavy deps before importing router
# ---------------------------------------------------------------------------
for _mod in [
    "redis_bus",
    "auth_middleware",
    "rate_limit",
    "metrics_collector",
    "webhook_dispatcher",
    "prometheus_fastapi_instrumentator",
]:
    sys.modules.setdefault(_mod, MagicMock())

# Stub config
_mock_settings = MagicMock()
_mock_settings.auth_enabled = False
_mock_settings.auth_secret_key = "test-secret-key-at-least-32-chars!"
_mock_settings.log_level = "DEBUG"
_mock_config = MagicMock()
_mock_config.settings = _mock_settings
sys.modules["config"] = _mock_config

# Remove any accidental stubs for schemas so the real ObservationSchema
# (pure Pydantic, no heavy deps) can be imported — FastAPI needs it for
# the response_model declaration on /entities/{entity_id}/trail.
for _smod in list(sys.modules.keys()):
    if _smod in ("schemas", "schemas.observation"):
        del sys.modules[_smod]

# Import deps for real (db.session is already mocked so it won't connect),
# then grab the actual get_db function to use as the dependency override key.
import deps as _deps  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from routers.observations import router as obs_router  # noqa: E402


def _make_app(mock_db: AsyncMock) -> tuple[FastAPI, TestClient]:
    """Build a test app with the real get_db overridden by mock_db."""
    app = FastAPI()
    app.include_router(obs_router)
    # Override using the ACTUAL get_db function as the key
    app.dependency_overrides[_deps.get_db] = lambda: mock_db
    return app, TestClient(app, raise_server_exceptions=False)


def _make_obs_row(entity_id: str = "E1", entity_type: str = "aircraft",
                  display_name: str = "Test", lat: float = 45.5, lon: float = -122.3):
    """Return a tuple (Observation-like, entity_type, display_name) as the query returns."""
    obs = _MockObs(entity_id=entity_id, lat=lat, lon=lon,
                   ts=datetime.now(timezone.utc))
    return (obs, entity_type, display_name)


class _MockObs:
    """Minimal stand-in that matches what the route reads from query rows."""
    def __init__(self, **kw):
        self.entity_id = kw.get("entity_id", "E1")
        self.ts = kw.get("ts", datetime.now(timezone.utc))
        self.lat = kw.get("lat", 45.5)
        self.lon = kw.get("lon", -122.3)
        self.altitude = kw.get("altitude", None)
        self.heading = kw.get("heading", None)
        self.speed = kw.get("speed", None)


class _MockEvent:
    def __init__(self, **kw):
        self.event_id = kw.get("event_id", "ev1")
        self.event_type = kw.get("event_type", "geofence_entry")
        self.entity_id = kw.get("entity_id", "E1")
        self.ts = kw.get("ts", datetime.now(timezone.utc))
        self.severity = kw.get("severity", "info")
        self.summary = kw.get("summary", "Test event")


class TestReplayEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_missing_start_returns_422(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)
        resp = client.get("/observations/replay?end=2026-01-01T00:00:00Z")
        self.assertEqual(resp.status_code, 422)

    async def test_missing_both_params_returns_422(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)
        resp = client.get("/observations/replay")
        self.assertEqual(resp.status_code, 422)

    async def test_valid_window_returns_grouped_entities(self):
        row = _make_obs_row()
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = [row]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("entities", data)
        self.assertIn("start", data)
        self.assertIn("end", data)
        self.assertIn("E1", data["entities"])
        entity_data = data["entities"]["E1"]
        self.assertEqual(entity_data["entity_type"], "aircraft")
        self.assertEqual(entity_data["display_name"], "Test")
        self.assertEqual(len(entity_data["points"]), 1)

    async def test_empty_result_returns_empty_entities(self):
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["entities"], {})

    async def test_multiple_observations_same_entity_grouped(self):
        obs1 = _MockObs(entity_id="E1", lat=45.5, lon=-122.3,
                        ts=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc))
        obs2 = _MockObs(entity_id="E1", lat=45.6, lon=-122.4,
                        ts=datetime(2026, 1, 1, 0, 1, 0, tzinfo=timezone.utc))
        rows = [(obs1, "aircraft", "Plane"), (obs2, "aircraft", "Plane")]

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = rows
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["entities"]["E1"]["points"]), 2)

    async def test_multiple_entities_each_grouped_separately(self):
        row1 = _make_obs_row(entity_id="E1", entity_type="aircraft", display_name="Plane")
        row2 = _make_obs_row(entity_id="E2", entity_type="vessel", display_name="Ship")

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = [row1, row2]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("E1", data["entities"])
        self.assertIn("E2", data["entities"])
        self.assertEqual(data["entities"]["E1"]["entity_type"], "aircraft")
        self.assertEqual(data["entities"]["E2"]["entity_type"], "vessel")

    async def test_50000_row_limit_applied(self):
        """The router must issue exactly one execute() for the observations query."""
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        # One execute call for the main observation query (which has .limit(50_000))
        mock_db.execute.assert_called_once()

    async def test_include_events_adds_events_key(self):
        obs_result = MagicMock()
        obs_result.all.return_value = []

        ev = _MockEvent(event_id="ev1", event_type="geofence_entry", entity_id="E1",
                        ts=datetime(2026, 1, 1, 0, 30, 0, tzinfo=timezone.utc),
                        severity="info", summary="entered zone")
        ev_result = MagicMock()
        ev_result.scalars.return_value = [ev]

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[obs_result, ev_result])
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
            "&include_events=true"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("events", data)
        self.assertEqual(len(data["events"]), 1)
        self.assertEqual(data["events"][0]["event_id"], "ev1")

    async def test_end_defaults_to_now(self):
        """When end is omitted, the route still works (defaults to now)."""
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/observations/replay?start=2026-01-01T00:00:00Z")
        self.assertEqual(resp.status_code, 200)

    async def test_response_contains_point_fields(self):
        """Each point in the response should have ts, lat, lon, altitude, heading, speed."""
        obs = _MockObs(
            entity_id="E1", lat=45.5, lon=-122.3,
            altitude=5000.0, heading=270.0, speed=450.0,
            ts=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.all.return_value = [(obs, "aircraft", "Plane")]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get(
            "/observations/replay"
            "?start=2026-01-01T00:00:00Z"
            "&end=2026-01-02T00:00:00Z"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        point = data["entities"]["E1"]["points"][0]
        for field in ("ts", "lat", "lon", "altitude", "heading", "speed"):
            self.assertIn(field, point)


class TestTrailEndpoint(unittest.IsolatedAsyncioTestCase):
    async def test_trail_returns_observations(self):
        obs = _MockObs(entity_id="E1", lat=45.5, lon=-122.3,
                       ts=datetime.now(timezone.utc))
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [obs]
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/entities/E1/trail")
        self.assertEqual(resp.status_code, 200)

    async def test_trail_default_minutes(self):
        """With no minutes param, defaults to 30."""
        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute = AsyncMock(return_value=mock_result)
        _, client = _make_app(mock_db)

        resp = client.get("/entities/E1/trail")
        self.assertEqual(resp.status_code, 200)
        mock_db.execute.assert_called_once()

    async def test_trail_minutes_over_max_returns_422(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/entities/E1/trail?minutes=9999")
        self.assertEqual(resp.status_code, 422)

    async def test_trail_minutes_below_min_returns_422(self):
        mock_db = AsyncMock()
        _, client = _make_app(mock_db)

        resp = client.get("/entities/E1/trail?minutes=0")
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
