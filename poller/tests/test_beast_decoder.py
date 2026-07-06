"""Unit tests for BEAST frame parsing and Mode S decode pipeline.

Run from the poller/ directory:
    pytest tests/

Or via Docker (recommended — matches production pyModeS version):
    docker compose run --rm poller python -m pytest tests/
"""
from __future__ import annotations

import math
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Stub heavy dependencies before any project imports so the module loader
# never tries to connect to Redis / Postgres / enrichment HTTP clients.
# ---------------------------------------------------------------------------
_mock_settings = MagicMock()
_mock_settings.region_lat = 52.3   # Netherlands — near POSITION_EVEN/ODD test frames
_mock_settings.region_lon = 3.5
_mock_settings.adsb_beast_reconnect_initial_seconds = 1
_mock_settings.adsb_beast_reconnect_max_seconds = 30
_mock_settings.adsb_beast_host = "localhost"
_mock_settings.adsb_beast_port = 30005
_mock_settings.adsb_publish_only_changes = True
_mock_settings.adsb_position_stale_seconds = 10
_mock_settings.adsb_dead_reckon_max_seconds = 60

for _mod in [
    "config",
    "bus",
    "db",
    "enrichment",
    "enrichment.aircraft_db",
    "enrichment.airlines_db",
    "enrichment.airports_db",
    "enrichment.adsbdb",
    "enrichment.metar",
    "enrichment.navaids_db",
    "enrichment.route_plausibility",
    "enrichment.cache",
    "normalizers.aircraft",
]:
    sys.modules.setdefault(_mod, MagicMock())

sys.modules["config"].settings = _mock_settings

# Ensure pollers package is importable from the poller root.
_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

# ---------------------------------------------------------------------------
# Detect whether pyModeS v2 API is available (needed for ingest/CPR tests).
# The project requires v2.21.1 which exposes pms.df(), pms.adsb.position(), etc.
# pyModeS v3+ has a completely different API.
# ---------------------------------------------------------------------------
try:
    import pyModeS as _pms_probe
    _HAS_V2_PYMODES = hasattr(_pms_probe, "df")
except ImportError:
    _HAS_V2_PYMODES = False

_SKIP_V2 = unittest.skipUnless(_HAS_V2_PYMODES, "requires pyModeS v2 (2.x) API")

# ---------------------------------------------------------------------------
# Project imports (after stubs are in place).
# ---------------------------------------------------------------------------
from normalizers.beast_decoder import (  # noqa: E402
    BeastAircraftDecoder,
    _AircraftState,
    _bearing_deg,
    _decode_bds40,
    _decode_bds44,
    _decode_bds50,
    _decode_bds60,
    _haversine_km,
    _infer_bds,
)


# ---------------------------------------------------------------------------
# Helper: build a raw BEAST frame byte sequence.
#
# BEAST wire format:
#   0x1A  <type>  <6B MLAT big-endian>  <1B signal>  <N bytes Mode S msg>
#
# Any 0x1A byte inside the body (MLAT, signal, or message) is escaped as
# 0x1A 0x1A on the wire.
# ---------------------------------------------------------------------------
def _make_beast_frame(
    frame_type: int,
    msg: bytes,
    mlat: int = 0,
    signal: int = 0x80,
) -> bytes:
    """Construct a BEAST frame with correct 0x1A escaping."""

    def _escape(data: bytes) -> bytes:
        return data.replace(b"\x1a", b"\x1a\x1a")

    mlat_bytes = mlat.to_bytes(6, "big")
    signal_byte = bytes([signal])
    body = mlat_bytes + signal_byte + msg
    return bytes([0x1A, frame_type]) + _escape(body)


# ============================================================================
# 1. BEAST Frame Parser
#    Tests _parse_one_beast_frame and _consume_beast_buffer on AdsbPoller.
#    These methods are pure (no instance-state access), so we use
#    object.__new__ to skip __init__ and avoid heavy dependency setup.
# ============================================================================
class TestBeastFrameParser(unittest.TestCase):
    """Tests for BEAST TCP stream frame boundary parsing via BeastTransport."""

    @classmethod
    def setUpClass(cls):
        from pollers.beast_transport import BeastTransport
        cls.transport = BeastTransport(on_frame=lambda msg, mlat, sig: None)

    def _parse(self, raw: bytes):
        """Thin wrapper: parse single frame from the start of raw bytes."""
        return self.transport.parse_frame(memoryview(bytearray(raw)))

    # --- Valid frames -------------------------------------------------------

    def test_df17_frame_parses_correctly(self):
        """A 14-byte DF17 (0x33) frame returns message, mlat, and signal."""
        msg = bytes.fromhex("8D4840D6202CC371C32CE0576098")  # 14 bytes
        frame = _make_beast_frame(0x33, msg, mlat=0x000000000001, signal=0x80)
        consumed, result = self._parse(frame)
        self.assertEqual(consumed, len(frame))
        self.assertIsNotNone(result)
        message, mlat_ticks, sig = result
        self.assertEqual(message, msg)
        self.assertEqual(mlat_ticks, 1)
        self.assertEqual(sig, 0x80)

    def test_df11_frame_parses_correctly(self):
        """A 7-byte DF11 (0x32) frame returns message, mlat, and signal."""
        msg = bytes([0x5D, 0x48, 0x40, 0xD6, 0xAA, 0xBB, 0xCC])  # 7 bytes
        frame = _make_beast_frame(0x32, msg, mlat=0x000000001234, signal=0x60)
        consumed, result = self._parse(frame)
        self.assertEqual(consumed, len(frame))
        self.assertIsNotNone(result)
        message, mlat_ticks, sig = result
        self.assertEqual(message, msg)
        self.assertEqual(mlat_ticks, 0x1234)
        self.assertEqual(sig, 0x60)

    def test_short_squitter_0x31_skipped(self):
        """A 0x31 (short squitter, 2-byte payload) frame is consumed but returns None."""
        msg = bytes([0xAA, 0xBB])  # 2 bytes
        frame = _make_beast_frame(0x31, msg)
        consumed, result = self._parse(frame)
        self.assertGreater(consumed, 0)
        self.assertIsNone(result)

    # --- Escape handling ----------------------------------------------------

    def test_escaped_0x1a_in_signal_byte(self):
        """Signal byte 0x1A is transmitted as 0x1A 0x1A; parser unescapes it."""
        msg = bytes(14)  # all zeros
        frame = _make_beast_frame(0x33, msg, signal=0x1A)
        # Wire frame should be longer than un-escaped (one extra byte for signal escape).
        consumed, result = self._parse(frame)
        self.assertIsNotNone(result)
        _, _, sig = result
        self.assertEqual(sig, 0x1A)
        # Consumed should account for the extra escape byte.
        self.assertEqual(consumed, len(frame))

    def test_escaped_0x1a_in_message_payload(self):
        """0x1A bytes inside the Mode S message are properly unescaped."""
        # Craft a 14-byte message with a 0x1A byte in the middle.
        msg = bytes([0x1A if i == 7 else i for i in range(14)])
        frame = _make_beast_frame(0x33, msg)
        consumed, result = self._parse(frame)
        self.assertIsNotNone(result)
        message, _, _ = result
        self.assertEqual(message, msg)

    # --- Incomplete / malformed frames --------------------------------------

    def test_incomplete_frame_returns_zero(self):
        """A buffer that is too short returns consumed=0 (wait for more data)."""
        msg = bytes(14)
        frame = _make_beast_frame(0x33, msg)
        # Feed only the first half.
        consumed, result = self._parse(frame[:10])
        self.assertEqual(consumed, 0)
        self.assertIsNone(result)

    def test_empty_buffer_returns_zero(self):
        consumed, result = self._parse(b"")
        self.assertEqual(consumed, 0)

    def test_single_byte_buffer_returns_zero(self):
        consumed, result = self._parse(b"\x1a")
        self.assertEqual(consumed, 0)

    def test_unknown_frame_type_returns_negative(self):
        """An unrecognised frame type at 0x1A <X> causes a negative skip."""
        consumed, result = self._parse(bytes([0x1A, 0xFF]))
        self.assertEqual(consumed, -1)
        self.assertIsNone(result)

    def test_garbage_before_sync_is_skipped(self):
        """Garbage bytes before 0x1A are skipped (negative consumed)."""
        msg = bytes(14)
        good_frame = _make_beast_frame(0x33, msg)
        garbage = bytes([0xDE, 0xAD, 0xBE, 0xEF])
        buf = garbage + good_frame
        consumed, result = self._parse(buf)
        # Should skip the 4 garbage bytes.
        self.assertLess(consumed, 0)
        self.assertEqual(abs(consumed), len(garbage))

    # --- Buffer-level multi-frame consumption --------------------------------

    def test_consume_buffer_two_frames(self):
        """_consume_buffer correctly parses two back-to-back frames."""
        msg1 = bytes.fromhex("8D4840D6202CC371C32CE0576098")
        msg2 = bytes([0x5D, 0x48, 0x40, 0xD6, 0xAA, 0xBB, 0xCC])
        buf = bytearray(
            _make_beast_frame(0x33, msg1) + _make_beast_frame(0x32, msg2)
        )
        consumed, messages = self.transport.consume_buffer(buf)
        self.assertEqual(consumed, len(buf))
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0][0], msg1)
        self.assertEqual(messages[1][0], msg2)

    def test_consume_buffer_garbage_then_frame(self):
        """Garbage before a valid frame is skipped; valid frame is returned."""
        msg = bytes.fromhex("8D4840D6202CC371C32CE0576098")
        garbage = bytes([0xDE, 0xAD])
        buf = bytearray(garbage + _make_beast_frame(0x33, msg))
        consumed, messages = self.transport.consume_buffer(buf)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0][0], msg)

    def test_consume_buffer_incomplete_at_end(self):
        """Incomplete trailing frame does not raise; consumed stops before it."""
        msg = bytes.fromhex("8D4840D6202CC371C32CE0576098")
        complete = _make_beast_frame(0x33, msg)
        incomplete = complete[:8]  # truncated second frame
        buf = bytearray(complete + incomplete)
        consumed, messages = self.transport.consume_buffer(buf)
        self.assertEqual(len(messages), 1)
        self.assertEqual(consumed, len(complete))  # only complete frame consumed


# ============================================================================
# 2. Geometry Helpers
# ============================================================================
class TestGeometryHelpers(unittest.TestCase):

    def test_haversine_same_point(self):
        self.assertAlmostEqual(_haversine_km(45.0, -122.0, 45.0, -122.0), 0.0, places=6)

    def test_haversine_one_degree_lat(self):
        # 1° latitude ≈ 111.195 km at equator.
        dist = _haversine_km(0.0, 0.0, 1.0, 0.0)
        self.assertAlmostEqual(dist, 111.195, delta=0.1)

    def test_haversine_portland_to_seattle(self):
        # Portland OR (45.52, -122.68) to Seattle WA (47.61, -122.33) ≈ 233 km.
        dist = _haversine_km(45.52, -122.68, 47.61, -122.33)
        self.assertAlmostEqual(dist, 233, delta=5)

    def test_bearing_due_north(self):
        bearing = _bearing_deg(0.0, 0.0, 1.0, 0.0)
        self.assertAlmostEqual(bearing, 0.0, delta=0.5)

    def test_bearing_due_east(self):
        bearing = _bearing_deg(0.0, 0.0, 0.0, 1.0)
        self.assertAlmostEqual(bearing, 90.0, delta=0.5)

    def test_bearing_due_south(self):
        bearing = _bearing_deg(1.0, 0.0, 0.0, 0.0)
        self.assertAlmostEqual(bearing, 180.0, delta=0.5)

    def test_bearing_due_west(self):
        bearing = _bearing_deg(0.0, 1.0, 0.0, 0.0)
        self.assertAlmostEqual(bearing, 270.0, delta=0.5)

    def test_bearing_wraps_at_360(self):
        b = _bearing_deg(45.0, -122.0, 46.0, -122.0)
        self.assertGreaterEqual(b, 0.0)
        self.assertLess(b, 360.0)


# ============================================================================
# 3. BDS Register Inference
# ============================================================================
class TestBDSInfer(unittest.TestCase):

    def test_recognises_bds40(self):
        self.assertEqual(_infer_bds(bytes([0x40, 0, 0, 0, 0, 0, 0])), "4,0")

    def test_recognises_bds44(self):
        self.assertEqual(_infer_bds(bytes([0x44, 0, 0, 0, 0, 0, 0])), "4,4")

    def test_recognises_bds50(self):
        self.assertEqual(_infer_bds(bytes([0x50, 0, 0, 0, 0, 0, 0])), "5,0")

    def test_recognises_bds60(self):
        self.assertEqual(_infer_bds(bytes([0x60, 0, 0, 0, 0, 0, 0])), "6,0")

    def test_unknown_register_returns_none(self):
        self.assertIsNone(_infer_bds(bytes([0x30, 0, 0, 0, 0, 0, 0])))
        self.assertIsNone(_infer_bds(bytes([0x41, 0, 0, 0, 0, 0, 0])))
        self.assertIsNone(_infer_bds(bytes([0x00, 0, 0, 0, 0, 0, 0])))

    def test_wrong_length_returns_none(self):
        self.assertIsNone(_infer_bds(bytes([0x40, 0, 0])))
        self.assertIsNone(_infer_bds(bytes(8)))
        self.assertIsNone(_infer_bds(b""))


# ============================================================================
# 4. BDS Register Decoders
# ============================================================================
class TestBDSDecode(unittest.TestCase):
    """Tests for _decode_bds40 / 44 / 50 / 60 pure-Python decoders.

    Payloads are hand-constructed from the bit layouts in the decoders.
    BDS code byte (0x40, 0x44, etc.) occupies the first byte.
    Data fields start at bit index 1 within the 56-bit (7-byte) bit string.
    """

    # --- BDS 4,0 (Selected altitude, QNH) -----------------------------------

    def test_bds40_returns_expected_keys(self):
        result = _decode_bds40(bytes([0x40, 0, 0, 0, 0, 0, 0]))
        self.assertIn("selected_altitude_mcp_ft", result)
        self.assertIn("selected_altitude_fms_ft", result)
        self.assertIn("qnh_hpa", result)

    def test_bds40_all_zeros_data(self):
        # payload[0]=0x40 → bits[0:8]='01000000'
        # bits[1:13] = '100000000000' = 2048 → mcp = 2048*16 = 32768 (in range → valid)
        # bits[14:26] = '000000000000' = 0 → fms = 0 (in range → valid)
        # bits[27:38] = '00000000000' = 0 → qnh = 800 (below 850 clamp → None)
        result = _decode_bds40(bytes([0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        self.assertEqual(result["selected_altitude_mcp_ft"], 32768.0)
        self.assertEqual(result["selected_altitude_fms_ft"], 0.0)
        self.assertIsNone(result["qnh_hpa"])  # 800 hPa is below the 850 clamp floor

    def test_bds40_altitude_out_of_range_clamped(self):
        # Set MCP bits so that mcp > 60000 → clamped to None.
        # bits[1:13] = all 1s = 4095 → mcp = 4095 * 16 = 65520 > 60000 → None
        # bits[1:13] spans payload[0] bit7-1 and payload[1] bits 7-3.
        # Easiest: set payload so that only MCP bits are all 1s.
        # bits[1:13] in the 56-bit concat:
        #   payload[0]=0x7F → '01111111' → bits[0..7] = 0,1,1,1,1,1,1,1
        #   bits[1:8] = '1111111' (7 bits from payload[0])
        #   payload[1]=0xE0 → '11100000' → bits[8..15] = 1,1,1,0,0,0,0,0
        #   bits[8:13] = '11100' (5 bits from payload[1])
        # Combined bits[1:13] = '1111111'+'11100' = '111111111100'
        # = 4092 → mcp = 4092 * 16 = 65472 > 60000 → clamped to None
        payload = bytes([0x7F, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00])
        result = _decode_bds40(payload)
        self.assertIsNone(result["selected_altitude_mcp_ft"])

    # --- BDS 4,4 (Meteorological) -------------------------------------------

    def test_bds44_returns_expected_keys(self):
        result = _decode_bds44(bytes([0x44, 0, 0, 0, 0, 0, 0]))
        for key in ("wind_speed_kt", "wind_direction_deg", "static_air_temperature_c"):
            self.assertIn(key, result)

    def test_bds44_zero_payload_gives_zero_wind(self):
        # With all-zero data bits, wind speed = 0 and wind direction = 0.
        result = _decode_bds44(bytes([0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))
        self.assertEqual(result.get("wind_speed_kt"), 0.0)

    # --- BDS 5,0 (Track and turn) -------------------------------------------

    def test_bds50_returns_expected_keys(self):
        result = _decode_bds50(bytes([0x50, 0, 0, 0, 0, 0, 0]))
        for key in ("roll_deg", "true_track_deg", "groundspeed_kt"):
            self.assertIn(key, result)

    # --- BDS 6,0 (Heading and speed) ----------------------------------------

    def test_bds60_returns_expected_keys(self):
        result = _decode_bds60(bytes([0x60, 0, 0, 0, 0, 0, 0]))
        for key in ("magnetic_heading_deg", "indicated_airspeed_kt", "mach"):
            self.assertIn(key, result)


# ============================================================================
# 5. BeastAircraftDecoder — missing-pyModeS guard
# ============================================================================
class TestDecoderNoPyModeS(unittest.TestCase):
    """Decoder should return None gracefully when pyModeS is unavailable."""

    def test_ingest_returns_none_without_pymodes(self):
        with patch("normalizers.beast_decoder.pms", None):
            decoder = BeastAircraftDecoder()
            result = decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
            self.assertIsNone(result)

    def test_snapshot_returns_empty_without_aircraft(self):
        decoder = BeastAircraftDecoder()
        self.assertEqual(decoder.snapshot_entities(), [])


# ============================================================================
# 5b. Ingest fast path — raw-byte DF/length rejection (no pyModeS calls)
# ============================================================================
class TestIngestFastPath(unittest.TestCase):
    """Frames rejected by length/DF must never reach pyModeS (hot-path guard)."""

    def _decoder_with_mock_pms(self):
        mock_pms = MagicMock()
        patcher = patch("normalizers.beast_decoder.pms", mock_pms)
        patcher.start()
        self.addCleanup(patcher.stop)
        return BeastAircraftDecoder(), mock_pms

    def test_wrong_length_rejected_before_pymodes(self):
        decoder, mock_pms = self._decoder_with_mock_pms()
        self.assertIsNone(decoder.ingest(b"\x8d" * 8))  # 8 bytes: not 7 or 14
        mock_pms.icao.assert_not_called()
        mock_pms.df.assert_not_called()

    def test_irrelevant_df_rejected_before_pymodes(self):
        decoder, mock_pms = self._decoder_with_mock_pms()
        # First byte 0x00 → DF0 (ACAS short reply), not in the accepted set.
        self.assertIsNone(decoder.ingest(b"\x00" + b"\x11" * 6))
        mock_pms.icao.assert_not_called()

    def test_df_derived_from_leading_byte(self):
        # 0x8D = 10001101 → DF17 (accepted); 0x20 = 00100000 → DF4 (accepted)
        self.assertEqual(0x8D >> 3, 17)
        self.assertEqual(0x20 >> 3, 4)
        self.assertEqual(0x00 >> 3, 0)


# ============================================================================
# 5c. Dead reckoning + cross-source seeding (no pyModeS required)
# ============================================================================
class TestDeadReckoning(unittest.TestCase):
    """_to_entity projects stale positions along the last known velocity."""

    def _aircraft(self, *, pos_age_s: float, vel_age_s: float | None, now: float) -> _AircraftState:
        ac = _AircraftState(icao="abc123")
        ac.lat = 45.0
        ac.lon = -122.0
        ac.altitude = 10000.0
        ac.heading = 90.0     # due east
        ac.speed = 360.0      # knots → 0.1 nm/s
        ac.vertical_rate = 0.0
        ac.on_ground = False
        ac.last_seen_ts = now
        ac.last_position_ts = now - pos_age_s
        ac.last_velocity_ts = None if vel_age_s is None else now - vel_age_s
        return ac

    def test_fresh_position_not_dead_reckoned(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=2.0, vel_age_s=1.0, now=now)
        entity = decoder._to_entity(ac, now=now)
        self.assertFalse(entity["position_stale"])
        self.assertFalse(entity["position_dr"])
        self.assertEqual(entity["lat"], 45.0)
        self.assertEqual(entity["lon"], -122.0)

    def test_stale_position_dead_reckoned_along_track(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=30.0, vel_age_s=5.0, now=now)
        entity = decoder._to_entity(ac, now=now)
        self.assertTrue(entity["position_stale"])
        self.assertTrue(entity["position_dr"])
        self.assertAlmostEqual(entity["position_age_s"], 30.0, delta=0.5)
        # 360 kt due east for 30 s ≈ 5.56 km → ~0.07° longitude at 45°N.
        self.assertGreater(entity["lon"], -122.0 + 0.03)
        self.assertAlmostEqual(entity["lat"], 45.0, delta=0.01)

    def test_dead_reckoning_capped_at_max_window(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=120.0, vel_age_s=5.0, now=now)
        entity = decoder._to_entity(ac, now=now)
        self.assertTrue(entity["position_stale"])
        self.assertFalse(entity["position_dr"])
        self.assertEqual(entity["lon"], -122.0)  # frozen at last real fix

    def test_no_dead_reckoning_without_velocity_timestamp(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=30.0, vel_age_s=None, now=now)
        entity = decoder._to_entity(ac, now=now)
        self.assertTrue(entity["position_stale"])
        self.assertFalse(entity["position_dr"])

    def test_hydrated_state_without_fix_ts_is_stale(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=0.0, vel_age_s=None, now=now)
        ac.last_position_ts = None  # Redis-hydrated: position but no fix time
        entity = decoder._to_entity(ac, now=now)
        self.assertTrue(entity["position_stale"])
        self.assertFalse(entity["position_dr"])
        self.assertIsNone(entity["position_age_s"])

    def test_altitude_projected_with_vertical_rate(self):
        import time
        now = time.time()
        decoder = BeastAircraftDecoder()
        ac = self._aircraft(pos_age_s=30.0, vel_age_s=5.0, now=now)
        ac.vertical_rate = -1200.0  # fpm descent
        entity = decoder._to_entity(ac, now=now)
        self.assertTrue(entity["position_dr"])
        self.assertAlmostEqual(entity["altitude"], 10000.0 - 600.0, delta=20.0)


class TestSeedReference(unittest.TestCase):
    """Cross-source CPR reference seeding (OpenSky / ultrafeeder → decoder)."""

    def test_seeds_unknown_aircraft(self):
        decoder = BeastAircraftDecoder()
        self.assertTrue(decoder.seed_reference("ABC123", 45.5, -122.3))
        ac = decoder._aircraft.get("abc123")
        self.assertIsNotNone(ac)
        self.assertEqual(ac.lat, 45.5)
        self.assertEqual(ac.lon, -122.3)
        # Seeded-only aircraft never appear in snapshots (no real frames yet).
        self.assertEqual(decoder.snapshot_entities(), [])

    def test_does_not_override_fresh_local_fix(self):
        import time
        decoder = BeastAircraftDecoder()
        ac = _AircraftState(icao="abc123")
        ac.lat, ac.lon = 45.0, -122.0
        ac.last_position_ts = time.time()  # fresh local CPR fix
        decoder._aircraft["abc123"] = ac
        self.assertFalse(decoder.seed_reference("abc123", 46.0, -121.0))
        self.assertEqual(ac.lat, 45.0)

    def test_overrides_stale_local_fix_with_newer_reference(self):
        import time
        decoder = BeastAircraftDecoder()
        ac = _AircraftState(icao="abc123")
        ac.lat, ac.lon = 45.0, -122.0
        ac.last_position_ts = time.time() - 60.0  # stale
        decoder._aircraft["abc123"] = ac
        self.assertTrue(decoder.seed_reference("abc123", 46.0, -121.0))
        self.assertEqual(ac.lat, 46.0)
        self.assertEqual(ac.lon, -121.0)

    def test_rejects_reference_older_than_local_fix(self):
        import time
        decoder = BeastAircraftDecoder()
        ac = _AircraftState(icao="abc123")
        ac.lat, ac.lon = 45.0, -122.0
        ac.last_position_ts = time.time() - 60.0
        decoder._aircraft["abc123"] = ac
        self.assertFalse(
            decoder.seed_reference("abc123", 46.0, -121.0, ts=time.time() - 300.0)
        )
        self.assertEqual(ac.lat, 45.0)


# ============================================================================
# 6. BeastAircraftDecoder — full decode (requires pyModeS v2)
# ============================================================================
@_SKIP_V2
class TestDecoderIngestV2(unittest.TestCase):
    """Decoder smoke tests using real Mode S hex messages.

    These require pyModeS 2.x (the version specified in requirements.txt).
    They are skipped in environments where only pyModeS 3.x is installed.
    """

    # Known-good DF17 hex strings from pyModeS documentation / test suite.
    # All messages are real ADS-B broadcasts from public Mode S test data.
    CALLSIGN_MSG  = "8D4840D6202CC371C32CE0576098"  # DF17 TC=4, callsign KLM1023
    POSITION_EVEN = "8D40621D58C382D690C8AC2863A7"  # DF17 TC=11, even CPR
    POSITION_ODD  = "8D40621D58C386435CC412692AD6"  # DF17 TC=11, odd  CPR
    VELOCITY_MSG  = "8D485020994409940838175B284F"  # DF17 TC=19, velocity

    def setUp(self):
        self.decoder = BeastAircraftDecoder()

    # --- Callsign -----------------------------------------------------------

    def test_callsign_decoded(self):
        msg = bytes.fromhex(self.CALLSIGN_MSG)
        self.decoder.ingest(msg)
        import pyModeS as pms
        icao = pms.icao(self.CALLSIGN_MSG).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertIsNotNone(ac)
        self.assertEqual(ac.callsign, "KLM1023")

    # --- Position (CPR global pair) -----------------------------------------

    def test_global_cpr_resolves_position(self):
        """Feed even+odd pair; decoder should resolve a lat/lon fix."""
        import pyModeS as pms
        even_bytes = bytes.fromhex(self.POSITION_EVEN)
        odd_bytes  = bytes.fromhex(self.POSITION_ODD)
        # Feed even first, then odd — pair within 10 s window.
        self.decoder.ingest(even_bytes)
        result = self.decoder.ingest(odd_bytes)
        icao = pms.icao(self.POSITION_EVEN).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertIsNotNone(ac)
        self.assertIsNotNone(ac.lat)
        self.assertIsNotNone(ac.lon)
        # CPR decode of this pair yields roughly lat≈52.25, lon≈3.92 (Netherlands)
        self.assertAlmostEqual(ac.lat, 52.25, delta=0.1)
        self.assertAlmostEqual(ac.lon, 3.92, delta=0.1)

    def test_entity_has_trail_pts_after_position(self):
        """After CPR resolves, entity dict should contain trail_pts."""
        even_bytes = bytes.fromhex(self.POSITION_EVEN)
        odd_bytes  = bytes.fromhex(self.POSITION_ODD)
        self.decoder.ingest(even_bytes)
        entity = self.decoder.ingest(odd_bytes)
        self.assertIsNotNone(entity)
        self.assertIn("trail_pts", entity)
        self.assertIsInstance(entity["trail_pts"], list)
        self.assertGreater(len(entity["trail_pts"]), 0)

    # --- Velocity -----------------------------------------------------------

    def test_velocity_decoded(self):
        import pyModeS as pms
        msg = bytes.fromhex(self.VELOCITY_MSG)
        self.decoder.ingest(msg)
        icao = pms.icao(self.VELOCITY_MSG).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertIsNotNone(ac)
        self.assertIsNotNone(ac.speed)
        self.assertIsNotNone(ac.heading)

    # --- Signal / MLAT metadata ---------------------------------------------

    def test_signal_stored(self):
        import pyModeS as pms
        msg = bytes.fromhex(self.CALLSIGN_MSG)
        self.decoder.ingest(msg, signal=200)
        icao = pms.icao(self.CALLSIGN_MSG).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertEqual(ac.signal_quality, 200)

    def test_mlat_ticks_stored(self):
        import pyModeS as pms
        msg = bytes.fromhex(self.CALLSIGN_MSG)
        self.decoder.ingest(msg, mlat_ticks=99999)
        icao = pms.icao(self.CALLSIGN_MSG).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertEqual(ac.last_mlat_ticks, 99999)

    def test_msg_count_increments(self):
        import pyModeS as pms
        msg = bytes.fromhex(self.CALLSIGN_MSG)
        for _ in range(3):
            self.decoder.ingest(msg)
        icao = pms.icao(self.CALLSIGN_MSG).lower()
        ac = self.decoder._aircraft.get(icao)
        self.assertEqual(ac.msg_count, 3)

    # --- last_seen timestamp semantics --------------------------------------

    def test_last_seen_not_future(self):
        """last_seen in entity dict must not be in the future."""
        import time
        even_bytes = bytes.fromhex(self.POSITION_EVEN)
        odd_bytes  = bytes.fromhex(self.POSITION_ODD)
        self.decoder.ingest(even_bytes)
        entity = self.decoder.ingest(odd_bytes)
        self.assertIsNotNone(entity)
        from datetime import datetime, timezone
        last_seen = datetime.fromisoformat(entity["last_seen"])
        now = datetime.now(tz=timezone.utc)
        self.assertLessEqual(last_seen, now)

    # --- snapshot_entities stale pruning ------------------------------------

    def test_snapshot_excludes_stale(self):
        """snapshot_entities with stale_seconds=0 should return nothing."""
        even_bytes = bytes.fromhex(self.POSITION_EVEN)
        odd_bytes  = bytes.fromhex(self.POSITION_ODD)
        self.decoder.ingest(even_bytes)
        self.decoder.ingest(odd_bytes)
        # With stale_seconds=0 all aircraft are already stale.
        stale_snapshot = self.decoder.snapshot_entities(stale_seconds=0)
        self.assertEqual(len(stale_snapshot), 0)

    def test_snapshot_includes_fresh(self):
        even_bytes = bytes.fromhex(self.POSITION_EVEN)
        odd_bytes  = bytes.fromhex(self.POSITION_ODD)
        self.decoder.ingest(even_bytes)
        self.decoder.ingest(odd_bytes)
        fresh_snapshot = self.decoder.snapshot_entities(stale_seconds=60)
        self.assertGreater(len(fresh_snapshot), 0)


# ============================================================================
# 7. CPR Guard Logic (requires pyModeS v2)
# ============================================================================
@_SKIP_V2
class TestCPRGuards(unittest.TestCase):
    """Teleport guard and heading-consistency guard in _update_cpr."""

    def setUp(self):
        import pyModeS as pms
        self.pms = pms
        self.decoder = BeastAircraftDecoder()
        # Pre-seed an aircraft with a known position.
        self.icao = "aabbcc"
        from collections import deque
        ac = _AircraftState(
            icao=self.icao,
            lat=45.523,
            lon=-122.676,
            heading=90.0,
            speed=250.0,
            last_position_ts=__import__("time").time(),
        )
        self.decoder._aircraft[self.icao] = ac

    def _mock_cpr_resolve(self, lat, lon):
        """Patch pms.adsb.position and position_with_ref to return a specific lat/lon."""
        return patch.multiple(
            "normalizers.beast_decoder.pms.adsb",
            position=lambda *a, **kw: (lat, lon),
            position_with_ref=lambda *a, **kw: (lat, lon),
            oe_flag=lambda *a, **kw: 0,
            typecode=lambda *a, **kw: 11,
            altitude=lambda *a, **kw: 35000.0,
        )

    def test_teleport_guard_rejects_implausible_jump(self):
        """A position >budget_km away from the last fix should be rejected."""
        ac = self.decoder._aircraft[self.icao]
        original_lat, original_lon = ac.lat, ac.lon
        # Attempt to "teleport" to Tokyo (~8700 km from Portland).
        with self._mock_cpr_resolve(35.682, 139.759):
            with patch("normalizers.beast_decoder.pms.df", return_value=17), \
                 patch("normalizers.beast_decoder.pms.icao", return_value=self.icao):
                self.decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
        # Position should be unchanged.
        self.assertAlmostEqual(ac.lat, original_lat, places=4)
        self.assertAlmostEqual(ac.lon, original_lon, places=4)

    def test_teleport_guard_accepts_plausible_movement(self):
        """A small movement within budget_km should be accepted."""
        ac = self.decoder._aircraft[self.icao]
        # Move ~0.5 km east — well within 5 s * 0.5 km/s = 2.5 km budget.
        new_lat, new_lon = 45.523, -122.669
        with self._mock_cpr_resolve(new_lat, new_lon):
            with patch("normalizers.beast_decoder.pms.df", return_value=17), \
                 patch("normalizers.beast_decoder.pms.icao", return_value=self.icao):
                self.decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
        self.assertAlmostEqual(ac.lat, new_lat, places=4)
        self.assertAlmostEqual(ac.lon, new_lon, places=4)

    def test_heading_guard_rejects_opposite_direction(self):
        """A position directly behind a fast aircraft (>90° off heading) is rejected."""
        ac = self.decoder._aircraft[self.icao]
        ac.heading = 90.0   # heading east
        ac.speed   = 250.0  # fast enough for heading guard to apply
        original_lat, original_lon = ac.lat, ac.lon
        # Position 0.5 km due WEST (bearing 270° — 180° off from heading 90°)
        west_lat, west_lon = 45.523, -122.683
        with self._mock_cpr_resolve(west_lat, west_lon):
            with patch("normalizers.beast_decoder.pms.df", return_value=17), \
                 patch("normalizers.beast_decoder.pms.icao", return_value=self.icao):
                self.decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
        self.assertAlmostEqual(ac.lat, original_lat, places=4)
        self.assertAlmostEqual(ac.lon, original_lon, places=4)

    def test_heading_guard_accepts_forward_position(self):
        """A position ahead of the aircraft (within ±90° of heading) is accepted."""
        ac = self.decoder._aircraft[self.icao]
        ac.heading = 90.0   # heading east
        ac.speed   = 250.0
        # Position 0.5 km due EAST (bearing 90° — matches heading exactly)
        east_lat, east_lon = 45.523, -122.669
        with self._mock_cpr_resolve(east_lat, east_lon):
            with patch("normalizers.beast_decoder.pms.df", return_value=17), \
                 patch("normalizers.beast_decoder.pms.icao", return_value=self.icao):
                self.decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
        self.assertAlmostEqual(ac.lat, east_lat, places=4)
        self.assertAlmostEqual(ac.lon, east_lon, places=4)

    def test_heading_guard_skipped_for_slow_aircraft(self):
        """Heading guard should be skipped when speed < 50 knots (ground taxi)."""
        ac = self.decoder._aircraft[self.icao]
        ac.heading = 90.0   # heading east
        ac.speed   = 10.0   # taxi speed — guard disabled
        # A "wrong direction" position that would normally be rejected.
        west_lat, west_lon = 45.523, -122.677  # tiny step west, within budget
        with self._mock_cpr_resolve(west_lat, west_lon):
            with patch("normalizers.beast_decoder.pms.df", return_value=17), \
                 patch("normalizers.beast_decoder.pms.icao", return_value=self.icao):
                self.decoder.ingest(bytes.fromhex("8D4840D6202CC371C32CE0576098"))
        # Should be accepted (guard disabled at low speed).
        self.assertAlmostEqual(ac.lat, west_lat, places=4)


# ============================================================================
# 8. Trail cache (_trail_dirty flag) — requires pyModeS v2
# ============================================================================
@_SKIP_V2
class TestTrailCache(unittest.TestCase):
    """Verify _trail_dirty flag controls trail_pts list reconstruction."""

    # Reuse the known-good CPR pair from section 6.
    POSITION_EVEN = "8D40621D58C382D690C8AC2863A7"
    POSITION_ODD  = "8D40621D58C386435CC412692AD6"

    def setUp(self):
        self.decoder = BeastAircraftDecoder()

    def _icao(self):
        import pyModeS as pms
        return pms.icao(self.POSITION_EVEN).lower()

    def _feed_pair(self):
        self.decoder.ingest(bytes.fromhex(self.POSITION_EVEN))
        return self.decoder.ingest(bytes.fromhex(self.POSITION_ODD))

    def test_cache_built_and_dirty_cleared_after_first_entity(self):
        """After the first CPR fix, _trail_cache is populated and dirty flag is False."""
        entity = self._feed_pair()
        ac = self.decoder._aircraft[self._icao()]
        self.assertIsNotNone(entity)
        self.assertFalse(ac._trail_dirty)
        self.assertIsInstance(ac._trail_cache, list)
        self.assertGreater(len(ac._trail_cache), 0)

    def test_cache_reused_without_new_position_fix(self):
        """snapshot_entities() returns the same list object when no new fix arrived."""
        self._feed_pair()
        ac = self.decoder._aircraft[self._icao()]
        cache_ref = ac._trail_cache

        # snapshot_entities calls _to_entity on the same aircraft with no new frame
        self.decoder.snapshot_entities()

        self.assertIs(ac._trail_cache, cache_ref)

    def test_cache_rebuilt_after_new_position_fix(self):
        """A second CPR fix increments pos_history, rebuilds the cache as a new list."""
        self._feed_pair()
        ac = self.decoder._aircraft[self._icao()]
        first_cache = ac._trail_cache

        # Second pair — appends another entry to pos_history
        entity = self._feed_pair()

        self.assertIsNotNone(entity)
        # New list object, longer than the first
        self.assertIsNot(ac._trail_cache, first_cache)
        self.assertGreaterEqual(len(ac._trail_cache), len(first_cache))
        self.assertFalse(ac._trail_dirty)


if __name__ == "__main__":
    unittest.main()
