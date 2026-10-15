"""emit_event: write once, announce, never raise."""
import asyncio
import json

import events


class FakeBus:
    def __init__(self):
        self.published = []

    async def publish(self, channel, payload):
        self.published.append((channel, json.loads(payload)))


def _wire(monkeypatch, recorded=False, write_id="evt-1", write_raises=False):
    bus = FakeBus()
    calls = {"write": [], "recorded": []}

    async def event_recorded(event_type, match):
        calls["recorded"].append((event_type, match))
        return recorded

    async def write_event(event_type, entity_id, severity, summary, details):
        if write_raises:
            raise RuntimeError("db down")
        calls["write"].append((event_type, entity_id, severity, summary, details))
        return write_id

    async def get_bus():
        return bus

    monkeypatch.setattr(events.db, "event_recorded", event_recorded)
    monkeypatch.setattr(events.db, "write_event", write_event)
    monkeypatch.setattr(events, "get_bus", get_bus)
    return bus, calls


def test_an_event_is_written_and_published_on_the_update_channel(monkeypatch):
    bus, calls = _wire(monkeypatch)
    eid = asyncio.run(events.emit_event("nwr_alert", "nwr:a1", "critical", "Tornado Warning heard", {"nwr_id": "a1"}, {"nwr_id": "a1"}))
    assert eid == "evt-1" and calls["write"][0][:3] == ("nwr_alert", "nwr:a1", "critical")
    channel, msg = bus.published[0]
    assert channel == "civic:updates" and msg["type"] == "event"
    assert msg["data"]["event_id"] == "evt-1" and msg["data"]["severity"] == "critical" and msg["data"]["details"] == {"nwr_id": "a1"}


def test_an_event_already_recorded_is_not_written_again(monkeypatch):
    bus, calls = _wire(monkeypatch, recorded=True)
    assert asyncio.run(events.emit_event("nwr_alert", "x", "low", "s", {}, {"nwr_id": "a1"})) is None
    assert calls["write"] == [] and bus.published == [] and calls["recorded"] == [("nwr_alert", {"nwr_id": "a1"})]


def test_without_a_dedupe_key_nothing_is_checked(monkeypatch):
    _, calls = _wire(monkeypatch)
    asyncio.run(events.emit_event("x", None, "low", "s", {}))
    assert calls["recorded"] == [] and len(calls["write"]) == 1


def test_a_database_failure_never_raises(monkeypatch):
    bus, _ = _wire(monkeypatch, write_raises=True)
    assert asyncio.run(events.emit_event("x", None, "low", "s", {})) is None and bus.published == []


def test_no_event_id_means_nothing_is_published(monkeypatch):
    bus, _ = _wire(monkeypatch, write_id="")
    assert asyncio.run(events.emit_event("x", None, "low", "s", {})) is None and bus.published == []
