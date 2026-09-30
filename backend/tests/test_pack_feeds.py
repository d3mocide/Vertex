"""Setup defaults must preserve operator choices and recover cleanly from failed saves."""
import copy
import os
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import yaml

import config_writer as writer
from pack_feeds import sync_pack_feeds

FEED = {"name": "Local News", "url": "https://example.invalid/news", "format": "rss"}
PACK = {"feeds": {"news": [FEED], "alerts": [{**FEED, "url": "https://example.invalid/alerts"}]}}


def test_seed_is_idempotent_and_does_not_mutate_input():
    original = {"radio_streams": [{"name": "Example Radio"}]}
    before = copy.deepcopy(original)
    seeded = writer.merge_pack_feeds(original, PACK)
    assert original == before
    assert seeded["news_feeds"] == [{**FEED, "enabled": True, "source": "pack"}]
    assert writer.merge_pack_feeds(seeded, PACK) == seeded


@pytest.mark.parametrize("source", ["config", "user", "pack"])
def test_existing_disabled_feed_and_operator_edits_win(source):
    feed = {**FEED, "name": "Operator Name", "enabled": False, "source": source}
    merged = writer.merge_pack_feeds({"news_feeds": [feed]}, PACK)
    assert merged["news_feeds"] == [feed]


def test_switch_and_core_only_remove_only_pack_owned_feeds():
    old = {**FEED, "url": "https://example.invalid/old", "source": "pack"}
    user = {**FEED, "url": "https://example.invalid/operator", "source": "user"}
    config = {**FEED, "url": "https://example.invalid/config"}
    original = {"news_feeds": [old, user, config]}
    switched = writer.merge_pack_feeds(original, PACK)
    assert switched["news_feeds"][:2] == [user, config]
    assert old not in switched["news_feeds"]
    assert writer.merge_pack_feeds(switched, None)["news_feeds"] == [user, config]


@pytest.mark.parametrize("bad", ["invalid", ["invalid"]])
def test_malformed_existing_config_is_refused(bad):
    with pytest.raises(ValueError):
        writer.merge_pack_feeds({"news_feeds": bad}, PACK)


@pytest.mark.asyncio
async def test_yaml_save_and_rollback_use_only_temporary_config(tmp_path, monkeypatch):
    path = tmp_path / "sources.yml"
    original = {"news_feeds": [{**FEED, "source": "user", "enabled": False}]}
    path.write_text(yaml.safe_dump(original))
    path.chmod(0o640)
    monkeypatch.setattr(writer, "CONFIG_PATH", path)
    with pytest.raises(RuntimeError):
        async with writer.pack_feed_config(PACK) as merged:
            assert yaml.safe_load(path.read_text()) == merged
            raise RuntimeError("database save failed")
    assert yaml.safe_load(path.read_text()) == original
    assert path.stat().st_mode & 0o777 == 0o640
    async with writer.pack_feed_config(PACK) as merged:
        pass
    assert yaml.safe_load(path.read_text()) == merged
    assert not list(tmp_path.glob(".sources-*"))


@pytest.mark.asyncio
async def test_db_reconciliation_preserves_manual_rows_and_removes_stale_defaults():
    user = SimpleNamespace(url=FEED["url"], source="user", enabled=False)
    old = SimpleNamespace(url="https://example.invalid/old", source="pack")
    kept = SimpleNamespace(url="https://example.invalid/kept", source="pack", name="Old", format="rss", enabled=True)
    rows = [user, old, kept]
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))),
                         delete=AsyncMock(), add=lambda row: added.append(row))
    added = []
    config = {"news_feeds": [{**FEED, "source": "pack"},
                             {**FEED, "url": kept.url, "source": "pack", "enabled": False}],
              "alert_feeds": []}
    # No alert rows in this fake database.
    db.execute.side_effect = [SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows)),
                             SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))]
    await sync_pack_feeds(db, config)
    db.delete.assert_awaited_once_with(old)
    assert user.enabled is False and kept.enabled is False and kept.name == FEED["name"]
    assert added == []


@pytest.mark.asyncio
async def test_missing_defaults_are_inserted_as_pack_owned():
    added = []
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))),
                         delete=AsyncMock(), add=added.append)
    await sync_pack_feeds(db, writer.merge_pack_feeds({}, PACK))
    assert len(added) == 2
    assert all(row.source == "pack" and row.enabled for row in added)


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [False, True])
async def test_setup_saves_feeds_and_region_together(tmp_path, monkeypatch, existing):
    from routers import region
    import pack_selection
    path = tmp_path / "sources.yml"
    path.write_text("{}")
    monkeypatch.setattr(writer, "CONFIG_PATH", path)
    monkeypatch.setattr(region.region_config, "env_locked_by", lambda settings: [])
    monkeypatch.setattr(region.pack_registry, "valid_by_id", lambda: {"oregon": PACK})
    monkeypatch.setattr(region, "load_effective", AsyncMock(return_value={"pack": "oregon"}))
    monkeypatch.setattr(pack_selection, "sync_pack_feeds", AsyncMock())
    row = SimpleNamespace(value={"pack": "none"}) if existing else None
    added = []
    db = SimpleNamespace(get=AsyncMock(side_effect=lambda model, key, **kwargs: row if key == "region" else None), execute=AsyncMock(),
                         add=added.append, commit=AsyncMock(), rollback=AsyncMock())
    body = region.RegionIn(name="Example Region", lat=45, lon=-122, timezone="America/Los_Angeles", pack="oregon")
    assert await region.set_region(body, db) == {"pack": "oregon"}
    stored = row.value if row else next(item.value for item in added if item.key == "region")
    assert stored["pack"] == "oregon" and len(stored["pack_feeds_signature"]) == 64
    assert yaml.safe_load(path.read_text())["news_feeds"][0]["source"] == "pack"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_setup_write_failure_does_not_commit_or_report_success(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from routers import region
    path = tmp_path / "sources.yml"
    path.write_text("{}")
    monkeypatch.setattr(writer, "CONFIG_PATH", path)
    monkeypatch.setattr(writer, "_write_raw", AsyncMock(side_effect=OSError("write refused")))
    monkeypatch.setattr(region.region_config, "env_locked_by", lambda settings: [])
    monkeypatch.setattr(region.pack_registry, "valid_by_id", lambda: {"oregon": PACK})
    db = SimpleNamespace(get=AsyncMock(return_value=None), execute=AsyncMock(), commit=AsyncMock(), rollback=AsyncMock())
    body = region.RegionIn(name="Example Region", lat=45, lon=-122, timezone="America/Los_Angeles", pack="oregon")
    with pytest.raises(HTTPException) as exc:
        await region.set_region(body, db)
    assert exc.value.status_code == 503
    db.commit.assert_not_awaited()
    db.rollback.assert_awaited_once()
