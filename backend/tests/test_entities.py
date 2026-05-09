"""Tests for the entities router (backend/routers/entities.py).

No live Redis or database required — redis_bus helpers are mocked.

Run from backend/:
    pytest tests/test_entities.py -v
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# Stub heavy dependencies before importing router.
# redis_bus must be stubbed BEFORE the import so the router's module-level
# `from redis_bus import get_all_entities, get_entity_state` picks up mocks.
# ---------------------------------------------------------------------------
_mock_get_all_entities = AsyncMock(return_value=[])
_mock_get_entity_state = AsyncMock(return_value=None)

_mock_redis_bus = MagicMock()
_mock_redis_bus.get_all_entities = _mock_get_all_entities
_mock_redis_bus.get_entity_state = _mock_get_entity_state
sys.modules["redis_bus"] = _mock_redis_bus

for _mod in [
    "db.session",
    "auth_middleware",
    "rate_limit",
    "metrics_collector",
    "webhook_dispatcher",
    "prometheus_fastapi_instrumentator",
    "geoalchemy2",
    "geoalchemy2.types",
    "deps",
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

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import routers.entities as _entities_module  # noqa: E402
from routers.entities import router as entities_router  # noqa: E402


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(entities_router)
    return TestClient(app, raise_server_exceptions=False)


# Sample entity dicts matching EntitySchema
_ENTITY_AIRCRAFT = {
    "entity_id": "ACA123",
    "entity_type": "aircraft",
    "source": "adsb",
    "display_name": "Air Canada 123",
    "lat": 45.5,
    "lon": -122.3,
    "altitude": 5000.0,
    "heading": 270.0,
    "speed": 450.0,
    "status": "airborne",
    "last_seen": "2026-01-01T00:00:00+00:00",
}

_ENTITY_VESSEL = {
    "entity_id": "MMSI123456789",
    "entity_type": "vessel",
    "source": "ais",
    "display_name": "MV Test",
    "lat": 45.6,
    "lon": -122.1,
    "altitude": None,
    "heading": 90.0,
    "speed": 12.0,
    "status": "underway",
    "last_seen": "2026-01-01T00:00:00+00:00",
}

_ENTITY_NO_POS = {
    "entity_id": "MESH001",
    "entity_type": "mesh_node",
    "source": "meshcore",
    "display_name": "Node 1",
    "lat": None,
    "lon": None,
    "altitude": None,
    "heading": None,
    "speed": None,
    "status": None,
    "last_seen": "2026-01-01T00:00:00+00:00",
}


class TestListEntities(unittest.TestCase):
    def setUp(self):
        # Reset return values on the original mock objects (NOT replacing them —
        # the router holds a direct reference so we must mutate, not replace).
        _entities_module.get_all_entities.reset_mock()
        _entities_module.get_entity_state.reset_mock()
        _entities_module.get_all_entities.return_value = []
        _entities_module.get_entity_state.return_value = None
        self.client = _make_client()

    def test_no_filters_returns_all_entities(self):
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT, _ENTITY_VESSEL]
        resp = self.client.get("/entities")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 2)

    def test_empty_result(self):
        _entities_module.get_all_entities.return_value = []
        resp = self.client.get("/entities")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_entity_type_filter_aircraft(self):
        """Router calls get_all_entities with entity_type argument."""
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT]
        resp = self.client.get("/entities?entity_type=aircraft")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["entity_type"], "aircraft")
        _entities_module.get_all_entities.assert_called_once_with("aircraft")

    def test_entity_type_filter_vessel(self):
        _entities_module.get_all_entities.return_value = [_ENTITY_VESSEL]
        resp = self.client.get("/entities?entity_type=vessel")
        self.assertEqual(resp.status_code, 200)
        _entities_module.get_all_entities.assert_called_once_with("vessel")

    def test_no_entity_type_passes_none(self):
        _entities_module.get_all_entities.return_value = []
        self.client.get("/entities")
        _entities_module.get_all_entities.assert_called_once_with(None)

    def test_pagination_limit_and_offset(self):
        """limit=2, offset=1 should skip the first entity."""
        entities = [_ENTITY_AIRCRAFT, _ENTITY_VESSEL, _ENTITY_NO_POS]
        _entities_module.get_all_entities.return_value = entities
        resp = self.client.get("/entities?limit=2&offset=1")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 2)
        # offset=1 skips index 0 (aircraft); returns index 1 (vessel) and 2 (mesh_node)
        self.assertEqual(data[0]["entity_id"], "MMSI123456789")
        self.assertEqual(data[1]["entity_id"], "MESH001")

    def test_pagination_offset_beyond_length(self):
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT]
        resp = self.client.get("/entities?offset=100")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_bbox_filter_inside(self):
        """Entity inside bbox passes through."""
        # Aircraft at lat=45.5, lon=-122.3; bbox: min_lon=-123, min_lat=45, max_lon=-122, max_lat=46
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT]
        resp = self.client.get("/entities?bbox=-123.0,45.0,-122.0,46.0")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)

    def test_bbox_filter_outside(self):
        """Entity outside bbox is excluded."""
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT]
        resp = self.client.get("/entities?bbox=-100.0,30.0,-90.0,35.0")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_bbox_excludes_entity_without_position(self):
        """Entity with lat=None/lon=None is excluded when bbox filter is active."""
        _entities_module.get_all_entities.return_value = [_ENTITY_NO_POS]
        resp = self.client.get("/entities?bbox=-123.0,45.0,-122.0,46.0")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_bbox_mixed_in_and_out(self):
        """Only entities inside bbox are returned."""
        _entities_module.get_all_entities.return_value = [_ENTITY_AIRCRAFT, _ENTITY_VESSEL]
        # Aircraft (lon=-122.3, lat=45.5) is inside; Vessel (lon=-122.1, lat=45.6) is outside max_lon=-122.2
        resp = self.client.get("/entities?bbox=-123.0,45.0,-122.2,45.55")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["entity_id"], "ACA123")

    def test_bad_bbox_returns_400(self):
        _entities_module.get_all_entities.return_value = []
        resp = self.client.get("/entities?bbox=bad")
        self.assertEqual(resp.status_code, 400)

    def test_bbox_wrong_part_count_returns_400(self):
        _entities_module.get_all_entities.return_value = []
        resp = self.client.get("/entities?bbox=-122.0,45.0,-121.0")
        self.assertEqual(resp.status_code, 400)


class TestGetEntityById(unittest.TestCase):
    def setUp(self):
        _entities_module.get_all_entities.reset_mock()
        _entities_module.get_entity_state.reset_mock()
        _entities_module.get_all_entities.return_value = []
        _entities_module.get_entity_state.return_value = None
        self.client = _make_client()

    def test_returns_entity_when_found(self):
        _entities_module.get_entity_state.return_value = _ENTITY_AIRCRAFT
        resp = self.client.get("/entities/ACA123")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["entity_id"], "ACA123")

    def test_returns_404_when_not_found(self):
        _entities_module.get_entity_state.return_value = None
        resp = self.client.get("/entities/DOESNOTEXIST")
        self.assertEqual(resp.status_code, 404)

    def test_entity_id_passed_to_redis(self):
        _entities_module.get_entity_state.return_value = _ENTITY_VESSEL
        self.client.get("/entities/MMSI123456789")
        _entities_module.get_entity_state.assert_called_once_with("MMSI123456789")


if __name__ == "__main__":
    unittest.main()
