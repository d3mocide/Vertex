"""OP25 websocket recording: call segmentation and talkgroup labelling."""
import asyncio
import json
import struct
import time

import pytest

from pollers import p25_recorder as rec


class FakeWS:
    """Replays a scripted message sequence; raises to end the session."""

    def __init__(self, messages):
        self._messages = list(messages)

    async def recv(self):
        if not self._messages:
            raise ConnectionError("closed")
        m = self._messages.pop(0)
        if m == "SLEEP":                       # simulate silence longer than the gap
            await asyncio.sleep(rec._WS_GAP_S + 0.2)
            return await self.recv()
        if m == "TICK":                        # let pending tasks (the OP25 label) run
            await asyncio.sleep(0.01)
            return await self.recv()
        return m


def _frame(n_samples=160):
    return b"\x01\x00" * n_samples              # 20 ms of int16 audio


def _run_session(monkeypatch, messages, channel=0, op25_now=None, live=None):
    saved = []
    r = rec.P25AudioRecorder()
    monkeypatch.setattr(r, "_spawn_save", lambda start, pcm, label=None: saved.append(len(pcm) / 2 / rec._WS_RATE))

    async def _op25_now(ch=0):
        return op25_now

    async def _publish(payload):
        if live is not None:
            live.append(payload)
    monkeypatch.setattr(r, "_op25_now", _op25_now)
    monkeypatch.setattr(r, "_publish_live", _publish)
    with pytest.raises(ConnectionError):
        asyncio.run(r._ws_session(FakeWS(messages), channel))
    return saved


def test_audio_drain_ends_a_call(monkeypatch):
    one_second = [_frame()] * 50
    saved = _run_session(monkeypatch, one_second + [json.dumps({"cmd": "audio_drain"})] + one_second
                         + [json.dumps({"cmd": "audio_drop"})])
    assert saved == [1.0, 1.0]


def test_silence_gap_ends_a_call_without_drain(monkeypatch):
    saved = _run_session(monkeypatch, [_frame()] * 50 + ["SLEEP"] + [_frame()] * 25
                         + [json.dumps({"cmd": "audio_drain"})])
    assert saved == [1.0, 0.5]


def test_drain_with_no_audio_saves_nothing(monkeypatch):
    assert _run_session(monkeypatch, [json.dumps({"cmd": "audio_drain"}), "not json"]) == []


def test_label_uses_nearest_call_start_and_never_reuses_an_id():
    r = rec.P25AudioRecorder()
    now = time.time()
    for eid, tg, dt in (("a", 1809, -30), ("b", 1091, 0.8), ("c", 1193, 12)):
        r._recent_calls.append({"id": eid, "tgid": tg, "tag": f"TG{tg}", "ts": now + dt})
    assert r._label_for(now) == ("b", 1091, "TG1091")
    # Same call split in two (audio_drop mid-call): second part gets a new id.
    assert r._label_for(now)[0] == "b-2"


def test_unmatched_segment_gets_tgid_zero():
    r = rec.P25AudioRecorder()
    r._recent_calls.append({"id": "old", "tgid": 1809, "tag": "x", "ts": time.time() - 120})
    call_id, tgid, tag = r._label_for(time.time())
    assert tgid == 0 and tag == "" and call_id != "old"


def test_live_frames_carry_receiver_and_talkgroup(monkeypatch):
    live = []
    _run_session(monkeypatch, [_frame(), "TICK", _frame(), json.dumps({"cmd": "audio_drain"})],
                 channel=1, op25_now=(34250, "WC Fire Disp"), live=live)
    audio = [m for m in live if m[:1] == b"A"]
    events = [json.loads(m[1:]) for m in live if m[:1] == b"J"]
    assert [a[1] for a in audio] == [1, 1]                       # receiver byte
    assert struct.unpack("<I", audio[0][2:6])[0] == 0            # label not known yet
    assert struct.unpack("<I", audio[1][2:6])[0] == 34250        # tagged once OP25 answers
    assert audio[1][6:] == _frame()
    assert {"ev": "label", "ch": 1, "tgid": 34250, "tag": "WC Fire Disp"} in events
    assert events[-1] == {"ev": "end", "ch": 1}
