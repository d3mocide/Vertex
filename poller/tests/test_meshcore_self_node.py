"""Tests for repeater self-node discovery and link normalization.

Run from poller/:
    pytest tests/test_meshcore_self_node.py
"""
from __future__ import annotations

import os
import sys

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from pollers.meshcore import (
    _extract_links_from_packets,
    _extract_self_position,
    _extract_self_pubkey,
    _parse_source,
)


class TestParseSourceSelfPin:
    def test_lat_lon_query_params(self):
        src = _parse_source("http://KEY@192.168.1.10:8000?lat=45.38&lon=-122.76")
        assert src["base_url"] == "http://192.168.1.10:8000"
        assert src["api_key"] == "KEY"
        assert src["self_lat"] == 45.38
        assert src["self_lon"] == -122.76

    def test_no_pin_defaults_none(self):
        src = _parse_source("http://192.168.1.10:8000")
        assert src["self_lat"] is None
        assert src["self_lon"] is None

    def test_invalid_pin_ignored(self):
        src = _parse_source("http://192.168.1.10:8000?lat=abc&lon=-122.76")
        assert src["self_lat"] is None
        assert src["self_lon"] is None

    def test_companion_and_pin_together(self):
        src = _parse_source("http://h:8000?companion=Base&lat=45.0&lon=-122.0")
        assert src["companion"] == "Base"
        assert src["self_lat"] == 45.0


class TestExtractSelfPosition:
    def test_top_level_gps_fields(self):
        assert _extract_self_position({"gps_lat": 45.4, "gps_lon": -122.7}) == (45.4, -122.7)

    def test_nested_node_info(self):
        stats = {"node_info": {"latitude": 45.4, "longitude": -122.7}}
        assert _extract_self_position(stats) == (45.4, -122.7)

    def test_zero_zero_rejected(self):
        assert _extract_self_position({"lat": 0.0, "lon": 0.0}) is None

    def test_out_of_range_rejected(self):
        assert _extract_self_position({"lat": 91.0, "lon": -122.7}) is None

    def test_missing_position(self):
        stats = {"radio_connected": True, "radio_stats": {"battery_mv": 3807}}
        assert _extract_self_position(stats) is None

    def test_non_dict(self):
        assert _extract_self_position(None) is None


class TestExtractSelfPubkey:
    def test_top_level_public_key(self):
        assert _extract_self_pubkey({"public_key": "abcdef123456"}) == "abcdef123456"

    def test_nested_self(self):
        assert _extract_self_pubkey({"self": {"pubkey": "cafe" * 4}}) == "cafe" * 4

    def test_all_zero_key_rejected(self):
        assert _extract_self_pubkey({"public_key": "0" * 64}) is None

    def test_missing(self):
        assert _extract_self_pubkey({"version": "1.15.0"}) is None


class TestExtractLinksSelfId:
    PACKETS = [{"data": {"snr": 8.5, "rssi": -48, "sender_pubkey": "aa11"}}]

    def test_default_local(self):
        links = _extract_links_from_packets(self.PACKETS, "http://h:8000")
        assert links[0]["node_a"] == "local"
        assert links[0]["node_b"] == "mesh_node:aa11"

    def test_self_entity_id(self):
        links = _extract_links_from_packets(
            self.PACKETS, "http://h:8000", "mesh_node:selfkey"
        )
        assert links[0]["node_a"] == "mesh_node:selfkey"
