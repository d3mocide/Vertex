"""Tests for MeshCore SSE event type handling and message normalization.

Run from poller/:
    pytest tests/test_meshcore_events.py
"""
from __future__ import annotations

import datetime
import os
import sys
import time
from unittest.mock import AsyncMock, patch

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)

import pytest
from pollers.meshcore import (
    MeshCorePoller,
    _MESSAGE_EVENT_TYPES,
    _message_time,
    _normalize_repeater_message,
)


class TestMessageEventTypes:
    def test_room_and_contact_events_included(self):
        assert "room_message_received" in _MESSAGE_EVENT_TYPES
        assert "room_message" in _MESSAGE_EVENT_TYPES
        assert "contact_message_received" in _MESSAGE_EVENT_TYPES
        assert "contact_message" in _MESSAGE_EVENT_TYPES
        assert "direct_message_received" in _MESSAGE_EVENT_TYPES
        assert "message_received" in _MESSAGE_EVENT_TYPES
        assert "channel_message_received" in _MESSAGE_EVENT_TYPES


class TestNormalizeRepeaterMessage:
    def test_positional_args(self):
        data = {
            "arg0": "Vertex",
            "arg1": "N0CALL",
            "arg2": "Hello World",
            "arg3": 1718000000,
            "arg6": "a1b2c3d4e5f6",
        }
        msg = _normalize_repeater_message(data, "http://192.168.1.10:8000", "room_message_received")
        assert msg["conversation_key"] == "Vertex"
        assert msg["sender_name"] == "N0CALL"
        assert msg["text"] == "Hello World"
        assert msg["sender_key"] == "a1b2c3d4e5f6"
        assert msg["msg_type"] == "channel"

    def test_direct_message_type(self):
        data = {
            "message_text": "Private text",
            "author_pubkey": "ff998877",
            "companion": "Secret",
        }
        msg = _normalize_repeater_message(data, "http://192.168.1.10:8000", "direct_message_received")
        assert msg["msg_type"] == "direct"
        assert msg["text"] == "Private text"


class TestMessageTime:
    def _age(self, dt):
        return abs((datetime.datetime.now(datetime.timezone.utc) - dt).total_seconds())

    def test_plausible_sender_time_is_kept(self):
        sent = time.time() - 120
        assert abs(_message_time(sent).timestamp() - sent) < 1

    def test_millisecond_timestamp_is_converted(self):
        sent = time.time() - 120
        assert abs(_message_time(sent * 1000).timestamp() - sent) < 1

    @pytest.mark.parametrize("bad", [4000000000, 1000000000, "junk", None, ""])
    def test_bad_clock_falls_back_to_receive_time(self, bad):
        assert self._age(_message_time(bad)) < 5

    def test_normalized_timestamp_is_parseable_iso(self):
        data = {"arg0": "V", "arg1": "X", "arg2": "hi", "arg3": 4000000000, "arg6": "abcd1234"}
        msg = _normalize_repeater_message(data, "http://x", "message")
        parsed = datetime.datetime.fromisoformat(msg["timestamp"])
        assert self._age(parsed) < 5


@pytest.mark.asyncio
class TestHandleSseEvent:
    @patch("pollers.meshcore.publish_entity", new_callable=AsyncMock)
    @patch("pollers.meshcore._save_mesh_message", new_callable=AsyncMock)
    @patch("pollers.meshcore.get_bus")
    async def test_room_message_received_event(self, mock_get_bus, mock_save, mock_publish_entity):
        mock_bus = AsyncMock()
        mock_get_bus.return_value = mock_bus

        poller = MeshCorePoller()
        data = {
            "arg0": "Vertex",
            "arg1": "Op1",
            "arg2": "Testing room msg",
            "arg6": "1234567890ab",
        }
        await poller._handle_sse_event("room_message_received", data, "http://192.168.50.65:8000")

        mock_save.assert_called_once()
        saved_msg = mock_save.call_args[0][0]
        assert saved_msg["text"] == "Testing room msg"
        assert saved_msg["conversation_key"] == "Vertex"
        assert mock_bus.publish.called
