"""Tests for Amtrak train normalization and dynamic bounding box region checking.

Run from poller/:
    pytest tests/test_amtrak_normalization.py
"""
from __future__ import annotations

import os
import sys
from unittest.mock import patch

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from config import RegionConfig, RegionBbox
from pollers.amtrak import _normalize, _in_bbox, _direction_to_heading


# Mock active regions for testing
MOCK_REGIONS = [
    RegionConfig(
        id="oregon",
        name="Oregon Region",
        bbox=RegionBbox(
            min_lat=41.9,
            max_lat=47.0,
            min_lon=-124.6,
            max_lon=-116.4,
        ),
        enabled=True,
    ),
    RegionConfig(
        id="california",
        name="California Region",
        bbox=RegionBbox(
            min_lat=32.5,
            max_lat=42.0,
            min_lon=-124.5,
            max_lon=-114.1,
        ),
        enabled=True,
    ),
]


class TestAmtrakNormalization:
    def _train(self, overrides: dict | None = None) -> dict:
        # Minimal valid Amtrak train payload
        base = {
            "trainNum": "500",
            "routeName": "Cascades",
            "lat": 45.5,
            "lon": -122.6,
            "velocity": 60,
            "heading": "N",
            "origCode": "PDX",
            "destCode": "SEA",
            "origName": "Portland",
            "destName": "Seattle",
            "eventCode": "Active",
            "lastValTS": "2026-05-19T12:00:00Z",
        }
        if overrides:
            base.update(overrides)
        return base

    @patch("config.load_regions")
    def test_in_bbox_matching_regions(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS

        # Portland is in Oregon region
        assert _in_bbox(45.5, -122.6) is True

        # Los Angeles is in California region
        assert _in_bbox(34.05, -118.24) is True

        # Seattle is outside Oregon region (lat 47.6 > 47.0)
        assert _in_bbox(47.6, -122.3) is False

        # Missing coords are excluded
        assert _in_bbox(None, -122.6) is False
        assert _in_bbox(45.5, None) is False

    @patch("config.load_regions")
    def test_normalize_valid_train(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS

        payload = self._train()
        result = _normalize(payload)

        assert result is not None
        assert result["entity_type"] == "train"
        assert result["entity_id"] == "train:amtrak:500"
        assert result["display_name"] == "Cascades #500"
        assert result["lat"] == 45.5
        assert result["lon"] == -122.6
        assert result["heading"] == 0.0  # "N" -> 0.0
        assert result["speed"] == 52.1   # 60 mph * 0.868976 = 52.138 knots -> 52.1
        assert result["status"] == "Active"
        assert result["identity"]["origin"] == "PDX"
        assert result["identity"]["destination"] == "SEA"
        assert result["tags"] == ["Cascades"]

    @patch("config.load_regions")
    def test_normalize_out_of_region_is_ignored(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS

        # Train is in Seattle, which is outside mock regions
        payload = self._train({"lat": 47.6, "lon": -122.3})
        result = _normalize(payload)
        assert result is None

    def test_direction_to_heading_cases(self):
        assert _direction_to_heading("N") == 0
        assert _direction_to_heading("S") == 180
        assert _direction_to_heading("ENE") == 67.5
        assert _direction_to_heading("invalid") is None
        assert _direction_to_heading(None) is None
