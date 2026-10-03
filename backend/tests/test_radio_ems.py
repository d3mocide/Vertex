import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from routers import radio


@pytest.mark.asyncio
async def test_ems_activity_returns_the_published_feed(monkeypatch):
    feed = {"ts": "2026-10-03T12:00:00+00:00", "window_hours": 24, "baseline_days": 8, "building": False, "reports": 130,
            "reports_baseline": 124.0, "flags": ["tox"],
            "syndromes": [{"key": "tox", "label": "Overdose / intoxication", "count": 22, "count_6h": 19,
                           "baseline": 6.0, "baseline_6h": 2.0, "flag": True}]}
    redis = SimpleNamespace(get=AsyncMock(return_value=json.dumps(feed)))
    monkeypatch.setattr(radio, "get_redis", lambda: redis)
    assert await radio.get_ems_activity() == feed
    redis.get.assert_awaited_with("feed:ems:activity")


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", [None, "not json"])
async def test_ems_activity_is_an_empty_building_state_when_nothing_is_published(monkeypatch, raw):
    redis = SimpleNamespace(get=AsyncMock(return_value=raw))
    monkeypatch.setattr(radio, "get_redis", lambda: redis)
    out = await radio.get_ems_activity()
    assert out["building"] is True and out["syndromes"] == [] and out["flags"] == [] and out["reports"] == 0
