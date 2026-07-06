"""Tests for pollers/beast_transport.py — BEAST wire-format frame parsing.

Covers both the fast path in consume_buffer (escape-free frames sliced at C
speed) and the parse_frame slow path (escaped bytes, garbage resync, and
incomplete buffers).

Run from poller/:
    pytest tests/test_beast_transport.py
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

# Stub heavy runtime deps so the module imports outside Docker.
_mock_settings = MagicMock()
_mock_settings.adsb_beast_stale_threshold_seconds = 60

for _mod in ("config", "security"):
    sys.modules.setdefault(_mod, MagicMock())
sys.modules["config"].settings = _mock_settings

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

from pollers.beast_transport import BeastTransport  # noqa: E402


def _transport() -> BeastTransport:
    return BeastTransport(on_frame=lambda m, t, s: None)


def _encode(msg: bytes, *, mlat: int = 0, signal: int = 100) -> bytes:
    """Encode a Mode S message into a BEAST wire frame (with 0x1A escaping)."""
    ftype = {2: 0x31, 7: 0x32, 14: 0x33}[len(msg)]
    body = mlat.to_bytes(6, "big") + bytes([signal]) + msg
    return bytes([0x1A, ftype]) + body.replace(b"\x1a", b"\x1a\x1a")


MSG_SHORT = bytes.fromhex("5D4840D6D4B2A6")                    # 7-byte DF11
MSG_LONG = bytes.fromhex("8D4840D6202CC371C32CE0576098")       # 14-byte DF17
MSG_WITH_1A = bytes.fromhex("8D1A40D6202CC371C32CE057601A")    # 0x1A in body


class TestFastPath:
    """Escape-free frames — taken by the consume_buffer fast path."""

    def test_single_long_frame(self):
        consumed, messages = _transport().consume_buffer(bytearray(_encode(MSG_LONG, mlat=12345, signal=88)))
        assert consumed == 2 + 7 + 14
        assert messages == [(MSG_LONG, 12345, 88)]

    def test_single_short_frame(self):
        consumed, messages = _transport().consume_buffer(bytearray(_encode(MSG_SHORT, mlat=7, signal=1)))
        assert consumed == 2 + 7 + 7
        assert messages == [(MSG_SHORT, 7, 1)]

    def test_multiple_frames_in_one_buffer(self):
        wire = _encode(MSG_LONG, mlat=1) + _encode(MSG_SHORT, mlat=2) + _encode(MSG_LONG, mlat=3)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert [m[1] for m in messages] == [1, 2, 3]
        assert [m[0] for m in messages] == [MSG_LONG, MSG_SHORT, MSG_LONG]

    def test_short_squitter_0x31_skipped(self):
        wire = _encode(bytes(2)) + _encode(MSG_LONG, mlat=9)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_LONG, 9, 100)]


class TestEscapedFrames:
    """Frames whose body contains 0x1A bytes — escaped on the wire, handled by
    the parse_frame slow path."""

    def test_escaped_message_body(self):
        wire = _encode(MSG_WITH_1A, mlat=42, signal=50)
        assert wire.count(b"\x1a") > 1  # escapes actually present on the wire
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_WITH_1A, 42, 50)]

    def test_escaped_mlat_and_signal(self):
        # 0x1A in the MLAT counter and the signal byte, not just the message.
        mlat = 0x1A1A1A1A1A1A
        wire = _encode(MSG_LONG, mlat=mlat, signal=0x1A)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_LONG, mlat, 0x1A)]

    def test_escaped_frame_followed_by_clean_frame(self):
        wire = _encode(MSG_WITH_1A, mlat=1) + _encode(MSG_LONG, mlat=2)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_WITH_1A, 1, 100), (MSG_LONG, 2, 100)]


class TestIncompleteAndGarbage:
    def test_incomplete_frame_waits_for_more_data(self):
        wire = _encode(MSG_LONG, mlat=5)
        consumed, messages = _transport().consume_buffer(bytearray(wire[:10]))
        assert consumed == 0
        assert messages == []
        # Frame completes once the rest arrives.
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_LONG, 5, 100)]

    def test_garbage_before_sync_marker_skipped(self):
        wire = b"\x00\xff\x42" + _encode(MSG_SHORT, mlat=3)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_SHORT, 3, 100)]

    def test_unknown_frame_type_resyncs(self):
        wire = b"\x1a\x99" + _encode(MSG_LONG, mlat=4)
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(wire)
        assert messages == [(MSG_LONG, 4, 100)]

    def test_trailing_partial_frame_preserved(self):
        full = _encode(MSG_LONG, mlat=1)
        wire = full + _encode(MSG_LONG, mlat=2)[:5]
        consumed, messages = _transport().consume_buffer(bytearray(wire))
        assert consumed == len(full)
        assert messages == [(MSG_LONG, 1, 100)]
