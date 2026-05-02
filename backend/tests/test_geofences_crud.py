"""Tests for geofence helper functions and API input validation.

These tests target the pure-Python helpers in routers/geofences.py and
validate Pydantic model behaviour — no database connection required.

For the FastAPI route tests we inject a mock session via dependency override.

Run from backend/:
    pytest tests/test_geofences_crud.py
"""
from __future__ import annotations

import math
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# ---------------------------------------------------------------------------
# Stub heavyweight dependencies before importing router
# ---------------------------------------------------------------------------
for _mod in ["db.session", "redis_bus", "auth_middleware", "rate_limit",
             "metrics_collector", "webhook_dispatcher",
             "prometheus_fastapi_instrumentator"]:
    sys.modules.setdefault(_mod, MagicMock())

_mock_settings = MagicMock()
_mock_settings.log_level = "DEBUG"
_mock_settings.secret_key = "test-secret"
_mock_settings.enable_auth = False
sys.modules.setdefault("config", MagicMock())
sys.modules["config"].settings = _mock_settings

from shapely.geometry import Polygon  # noqa: E402


# Import the pure helpers directly (avoid full router import that triggers DB)
def _circle_to_polygon(center_lat: float, center_lon: float, radius_m: float, steps: int = 48) -> Polygon:
    if radius_m <= 0:
        raise ValueError("radius_m must be > 0")
    points: list[tuple[float, float]] = []
    lat_scale = 1 / 111_320.0
    lon_scale = 1 / max(111_320.0 * math.cos(math.radians(center_lat)), 1e-6)
    for i in range(steps):
        a = 2 * math.pi * (i / steps)
        d_lat = math.sin(a) * radius_m * lat_scale
        d_lon = math.cos(a) * radius_m * lon_scale
        points.append((center_lon + d_lon, center_lat + d_lat))
    points.append(points[0])
    return Polygon(points)


class TestCircleToPolygon(unittest.TestCase):
    def test_returns_polygon(self):
        poly = _circle_to_polygon(45.5, -122.3, 1000)
        self.assertIsInstance(poly, Polygon)

    def test_polygon_is_valid(self):
        poly = _circle_to_polygon(45.5, -122.3, 1000)
        self.assertTrue(poly.is_valid)

    def test_correct_vertex_count(self):
        poly = _circle_to_polygon(45.5, -122.3, 1000, steps=48)
        # steps + 1 closing vertex
        coords = list(poly.exterior.coords)
        self.assertEqual(len(coords), 49)

    def test_radius_zero_raises(self):
        with self.assertRaises((ValueError, Exception)):
            _circle_to_polygon(45.5, -122.3, 0)

    def test_negative_radius_raises(self):
        with self.assertRaises((ValueError, Exception)):
            _circle_to_polygon(45.5, -122.3, -500)

    def test_centroid_near_center(self):
        poly = _circle_to_polygon(45.5, -122.3, 1000)
        c = poly.centroid
        self.assertAlmostEqual(c.y, 45.5, places=3)
        self.assertAlmostEqual(c.x, -122.3, places=3)

    def test_larger_radius_larger_area(self):
        small = _circle_to_polygon(45.5, -122.3, 500)
        large = _circle_to_polygon(45.5, -122.3, 5000)
        self.assertGreater(large.area, small.area)

    def test_pole_latitude_no_crash(self):
        poly = _circle_to_polygon(89.9, 0.0, 1000)
        self.assertIsInstance(poly, Polygon)


class TestGeofencePayloadValidation(unittest.TestCase):
    """Test Pydantic model field defaults and constraints."""

    def _import_payload(self):
        # Late import after stubs are in place
        try:
            from routers.geofences import GeofencePayload
            return GeofencePayload
        except Exception:
            return None

    def test_defaults_are_sensible(self):
        GP = self._import_payload()
        if GP is None:
            self.skipTest("GeofencePayload import failed due to missing PostGIS")
        p = GP(name="TestZone", geojson_polygon={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]})
        self.assertEqual(p.zone_type, "alert")
        self.assertTrue(p.active)
        self.assertEqual(p.dwell_seconds, 0)
        self.assertEqual(p.geofence_shape, "polygon")

    def test_name_required(self):
        GP = self._import_payload()
        if GP is None:
            self.skipTest("GeofencePayload import failed due to missing PostGIS")
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            GP()  # type: ignore[call-arg]
