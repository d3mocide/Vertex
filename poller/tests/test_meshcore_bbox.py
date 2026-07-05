"""Tests for MeshCore node bbox gating.

Run from poller/:
    pytest tests/test_meshcore_bbox.py
"""
from __future__ import annotations

import os
import sys
from unittest.mock import patch

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from config import RegionConfig, RegionBbox, settings
from pollers.meshcore import _in_region, _should_publish_node


# Portland-metro-ish region
MOCK_REGIONS = [
    RegionConfig(
        id="portland",
        name="Portland Metro",
        bbox=RegionBbox(
            min_lat=44.8,
            max_lat=45.9,
            min_lon=-123.5,
            max_lon=-121.8,
        ),
        enabled=True,
    ),
]


def _node(lat, lon) -> dict:
    return {
        "entity_id": "mesh_node:abc123",
        "entity_type": "mesh_node",
        "lat": lat,
        "lon": lon,
    }


class TestInRegion:
    @patch.object(settings, "mesh_bbox_pad_deg", 0.25)
    @patch("config.load_regions")
    def test_inside_bbox(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        assert _in_region(45.38, -122.76) is True   # Tualatin

    @patch.object(settings, "mesh_bbox_pad_deg", 0.25)
    @patch("config.load_regions")
    def test_far_outside_bbox(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        assert _in_region(47.6, -122.3) is False    # Seattle
        assert _in_region(44.05, -123.09) is False  # Eugene

    @patch.object(settings, "mesh_bbox_pad_deg", 0.25)
    @patch("config.load_regions")
    def test_pad_extends_bbox(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        # Just north of max_lat 45.9 but within the 0.25° pad
        assert _in_region(46.1, -122.5) is True
        # Beyond the pad
        assert _in_region(46.2, -122.5) is False


class TestShouldPublishNode:
    @patch.object(settings, "mesh_bbox_filter", True)
    @patch.object(settings, "mesh_bbox_pad_deg", 0.25)
    @patch("config.load_regions")
    def test_gates_out_of_region_node(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        assert _should_publish_node(_node(45.38, -122.76)) is True
        assert _should_publish_node(_node(47.6, -122.3)) is False

    @patch.object(settings, "mesh_bbox_filter", True)
    @patch("config.load_regions")
    def test_unpositioned_node_always_passes(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        assert _should_publish_node(_node(None, None)) is True
        assert _should_publish_node(_node(45.38, None)) is True
        mock_load_regions.assert_not_called()

    @patch.object(settings, "mesh_bbox_filter", False)
    @patch("config.load_regions")
    def test_disabled_filter_passes_everything(self, mock_load_regions):
        mock_load_regions.return_value = MOCK_REGIONS
        assert _should_publish_node(_node(47.6, -122.3)) is True
        mock_load_regions.assert_not_called()
