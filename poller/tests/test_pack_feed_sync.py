"""Pack sources survive restart and database recreation without taking ownership of user rows."""
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from config_loader import AlertFeedEntry, NewsFeedEntry, SourcesConfig
from config_sync import _sync_alert_feeds, _sync_news_feeds


def test_pack_feed_sources_parse():
    config = SourcesConfig.model_validate({
        "news_feeds": [{"name": "News", "url": "https://example.invalid/news", "source": "pack"}],
        "alert_feeds": [{"name": "Alerts", "url": "https://example.invalid/alerts", "source": "pack", "enabled": False}],
    })
    assert config.news_feeds[0].source == "pack"
    assert config.alert_feeds[0].enabled is False


@pytest.mark.asyncio
@pytest.mark.parametrize("sync,model", [(_sync_news_feeds, NewsFeedEntry), (_sync_alert_feeds, AlertFeedEntry)])
async def test_pack_rows_restore_after_db_wipe(sync, model):
    conn = SimpleNamespace(fetch=AsyncMock(return_value=[]), execute=AsyncMock())
    entry = model(name="Feed", url="https://example.invalid/feed", source="pack", enabled=False)
    assert await sync([entry], conn) == "+1 -0"
    args = conn.execute.await_args.args
    assert "INSERT INTO" in args[0] and args[-2:] == (False, "pack")


@pytest.mark.asyncio
@pytest.mark.parametrize("sync", [_sync_news_feeds, _sync_alert_feeds])
async def test_switch_removes_pack_rows_only(sync):
    conn = SimpleNamespace(fetch=AsyncMock(return_value=[
        {"name": "Pack", "url": "https://example.invalid/old", "source": "pack"},
        {"name": "User", "url": "https://example.invalid/user", "source": "user"},
    ]), execute=AsyncMock())
    assert await sync([], conn) == "+0 -1"
    args = conn.execute.await_args.args
    assert "source IN ('config', 'pack')" in args[0]
    assert "user" not in str(args[1:])


@pytest.mark.asyncio
@pytest.mark.parametrize("sync,model", [(_sync_news_feeds, NewsFeedEntry), (_sync_alert_feeds, AlertFeedEntry)])
async def test_existing_user_url_is_not_inserted_again(sync, model):
    url = "https://example.invalid/feed"
    conn = SimpleNamespace(fetch=AsyncMock(return_value=[{"name": "Operator", "url": url, "source": "user"}]), execute=AsyncMock())
    assert await sync([model(name="Default", url=url, source="pack")], conn) == ""
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("sync,model", [(_sync_news_feeds, NewsFeedEntry), (_sync_alert_feeds, AlertFeedEntry)])
async def test_yaml_edits_update_pack_rows_on_restart(sync, model):
    url = "https://example.invalid/feed"
    conn = SimpleNamespace(fetch=AsyncMock(return_value=[{"name": "Old", "url": url, "source": "pack"}]),
                           execute=AsyncMock(return_value="UPDATE 1"))
    assert await sync([model(name="New", url=url, source="pack", enabled=False)], conn) == "+0 -0 ~1"
    args = conn.execute.await_args.args
    assert args[1:] == (url, "New", "rss", False, "pack")


@pytest.mark.asyncio
async def test_disabled_alert_feeds_do_not_trigger_environment_fallback(monkeypatch):
    import pollers.alerts as alerts
    import db
    pool = SimpleNamespace(fetch=AsyncMock(side_effect=[[], [
        {"name": "Disabled", "url": "https://example.invalid/alerts", "format": "rss", "enabled": False},
    ]]))
    monkeypatch.setattr(db, "get_pool", lambda: pool)
    monkeypatch.setattr(alerts.settings, "flashalert_enabled", True)
    monkeypatch.setattr(alerts.settings, "flashalert_url", "https://example.invalid/legacy")
    poller = alerts.AlertPoller()
    await poller.setup()
    assert poller._alert_feeds == []
