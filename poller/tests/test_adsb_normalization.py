"""Tests for ADS-B aircraft normalization (OpenSky + tar1090 JSON paths).

Run from poller/:
    pytest tests/test_adsb_normalization.py
"""
from __future__ import annotations

import os
import sys

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from normalizers.aircraft import normalize_opensky, normalize_tar1090


# ── normalize_opensky ────────────────────────────────────────────────────────

class TestNormalizeOpensky:
    def _state(self, overrides: dict | None = None) -> list:
        # Minimal valid OpenSky state vector
        base = [
            "a1b2c3",      # 0 icao24
            "UAL123  ",    # 1 callsign (with trailing spaces)
            "United States",  # 2 origin_country
            1700000000,    # 3 time_position
            1700000001,    # 4 last_contact
            -122.3,        # 5 longitude
            45.5,          # 6 latitude
            10000.0,       # 7 baro_altitude
            False,         # 8 on_ground
            250.0,         # 9 velocity
            90.0,          # 10 true_track
            0.0,           # 11 vertical_rate
            None,          # 12 sensors
            10500.0,       # 13 geo_altitude
            "1200",        # 14 squawk
            False,         # 15 spi
            0,             # 16 position_source
        ]
        if overrides:
            for k, v in overrides.items():
                base[k] = v
        return base

    def test_valid_state_returns_dict(self):
        result = normalize_opensky(self._state())
        assert result is not None
        assert result["entity_type"] == "aircraft"
        assert result["entity_id"] == "aircraft:a1b2c3"

    def test_callsign_stripped(self):
        result = normalize_opensky(self._state())
        assert result is not None
        assert result["identity"]["callsign"] == "UAL123"

    def test_icao_lowercased(self):
        result = normalize_opensky(self._state({0: "A1B2C3"}))
        assert result is not None
        assert result["entity_id"] == "aircraft:a1b2c3"

    def test_lat_lon_mapped(self):
        result = normalize_opensky(self._state())
        assert result is not None
        assert result["lat"] == 45.5
        assert result["lon"] == -122.3

    def test_on_ground_status(self):
        result = normalize_opensky(self._state({8: True}))
        assert result is not None
        assert result["status"] == "on_ground"

    def test_airborne_status(self):
        result = normalize_opensky(self._state({8: False}))
        assert result is not None
        assert result["status"] == "airborne"

    def test_missing_lat_returns_none(self):
        assert normalize_opensky(self._state({6: None})) is None

    def test_missing_lon_returns_none(self):
        assert normalize_opensky(self._state({5: None})) is None

    def test_too_short_returns_none(self):
        assert normalize_opensky([]) is None

    def test_empty_callsign_uses_icao(self):
        result = normalize_opensky(self._state({1: "  "}))
        assert result is not None
        assert result["display_name"] == "A1B2C3"

    def test_squawk_present(self):
        result = normalize_opensky(self._state())
        assert result is not None
        assert result["identity"]["squawk"] == "1200"


# ── normalize_tar1090 ────────────────────────────────────────────────────────

class TestNormalizeTar1090:
    def _ac(self, overrides: dict | None = None) -> dict:
        base = {
            "hex": "a1b2c3",
            "flight": "UAL456 ",
            "lat": 45.5,
            "lon": -122.3,
            "alt_baro": 12000,
            "track": 180.0,
            "gs": 300.0,
            "baro_rate": -256,
            "on_ground": False,
            "squawk": "2000",
            "category": "A3",
        }
        if overrides:
            base.update(overrides)
        return base

    def test_valid_returns_dict(self):
        result = normalize_tar1090(self._ac())
        assert result is not None
        assert result["entity_type"] == "aircraft"

    def test_flight_stripped(self):
        result = normalize_tar1090(self._ac())
        assert result is not None
        assert result["identity"]["callsign"] == "UAL456"

    def test_missing_lat_returns_none(self):
        assert normalize_tar1090(self._ac({"lat": None})) is None

    def test_missing_lon_returns_none(self):
        assert normalize_tar1090(self._ac({"lon": None})) is None

    def test_missing_hex_returns_none(self):
        assert normalize_tar1090(self._ac({"hex": ""})) is None

    def test_alt_baro_used_first(self):
        result = normalize_tar1090(self._ac({"alt_baro": 15000, "alt_geom": 15200}))
        assert result is not None
        assert result["altitude"] == 15000

    def test_alt_geom_fallback(self):
        result = normalize_tar1090(self._ac({"alt_baro": None, "alt_geom": 15200}))
        assert result is not None
        assert result["altitude"] == 15200

    def test_on_ground_status(self):
        result = normalize_tar1090(self._ac({"on_ground": True}))
        assert result is not None
        assert result["status"] == "on_ground"

    def test_source_is_ultrafeeder(self):
        result = normalize_tar1090(self._ac())
        assert result is not None
        assert result["source"] == "ultrafeeder"

    def test_entity_id_format(self):
        result = normalize_tar1090(self._ac())
        assert result is not None
        assert result["entity_id"] == "aircraft:a1b2c3"

