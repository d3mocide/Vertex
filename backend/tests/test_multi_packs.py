"""Border-area selection, additive capabilities and pin-independent pack setup."""
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException

import capabilities
import config_writer
import pack_registry
import pack_selection
import region_config
from provider_catalog import (CONTRACT_IDS, PROVIDERS, combined_feeds, provider_plan, selected_ids, selection_signature)
from pack_support import discover

REGIONS = Path(os.environ.get("REGION_PACKS_DIR", "/regions"))
if not REGIONS.is_dir():
    REGIONS = Path(__file__).resolve().parents[2] / "regions"
BORDER = {"min_lat": 45, "max_lat": 46.1, "min_lon": -123.2, "max_lon": -122}
SETTINGS = SimpleNamespace(region_lat=45.5, region_lon=-122.7, region_name="Example Metro",
                           region_timezone="America/Los_Angeles", odot_api_key="fixture-key", wsdot_api_key="fixture-key",
                           **{"bbox_" + k: v for k, v in BORDER.items()})


def installed():
    return {p["id"]: p for p in discover(REGIONS, CONTRACT_IDS) if p["valid"]}


def region(ids):
    return {"name": "Example Metro", "center": [45.5, -122.7], "timezone": "America/Los_Angeles", "bbox": BORDER,
            "packs": ids, "pack": ids[0] if ids else "none"}


def test_both_shipped_packs_run_in_border_area():
    plan, errors = provider_plan(["oregon", "washington"], installed(), SETTINGS, BORDER)
    assert errors == {} and set(plan) == set(PROVIDERS)
    assert all(p["reason"] is None for pid, p in plan.items() if pid not in {"trimet-transit", "ctran-transit", "soundtransit-transit"})
    assert plan["ctran-transit"]["reason"] == "access_unverified"
    assert plan["soundtransit-transit"]["reason"] == "outside_coverage"
    assert provider_plan(["oregon"], installed(), SETTINGS, BORDER)[0].keys() == PROVIDERS.keys() - {"wsdot-travel", "wadnr-fire-danger", "ctran-transit", "soundtransit-transit"}


def test_washington_runs_even_if_center_is_south_of_its_coverage():
    settings = SimpleNamespace(**{**vars(SETTINGS), "region_lat": 45.4})
    assert settings.region_lat < PROVIDERS["wsdot-travel"]["bbox"][1]
    assert provider_plan(["washington"], installed(), settings, BORDER)[0]["wsdot-travel"]["reason"] is None


def test_core_only_and_legacy_are_distinct():
    assert provider_plan([], installed(), SETTINGS, BORDER)[0] == {}
    assert "wsdot-travel" not in provider_plan(None, installed(), SETTINGS, BORDER)[0]
    assert selected_ids({"pack": "oregon"}) == ["oregon"]
    assert selected_ids({"pack": "none"}) == []
    assert selected_ids({}) is None


def test_missing_odot_key_does_not_disable_washington():
    settings = SimpleNamespace(**{**vars(SETTINGS), "odot_api_key": ""})
    plan, _ = provider_plan(["oregon", "washington"], installed(), settings, BORDER)
    assert plan["odot-tripcheck"]["reason"] == "not_configured"
    assert plan["wsdot-travel"]["reason"] is None
    out = capabilities.build(settings, {}, region(["oregon", "washington"]), installed())
    assert out["contracts"]["traffic.incidents"]["providers"] == ["wsdot-travel"]
    assert out["contracts"]["traffic.signs"]["reason"] == "not_configured"


def test_each_provider_has_independent_freshness_and_no_cross_feed_masking():
    ages = {"provider:odot-tripcheck:traffic:incidents": 1900,
            "provider:wsdot-travel:traffic:incidents": 5, "traffic:incidents": 5}
    contract = capabilities.build(SETTINGS, ages, region(["oregon", "washington"]), installed())["contracts"]["traffic.incidents"]
    assert set(contract["providers"]) == {"odot-tripcheck", "wsdot-travel"}
    assert contract["status"] == "ok"
    assert contract["provider_statuses"]["odot-tripcheck"]["status"] == "down"
    assert contract["provider_statuses"]["wsdot-travel"]["status"] == "ok"
    ages = {"traffic:incidents": 1}
    out = capabilities.build(SETTINGS, ages, region(["washington"]), installed())
    assert out["contracts"]["traffic.incidents"]["status"] == "pending"


def test_washington_does_not_claim_oregon_only_contracts():
    out = capabilities.build(SETTINGS, {}, region(["washington"]), installed())
    assert out["contracts"]["traffic.cameras"]["providers"] == ["wsdot-travel"]
    assert out["contracts"]["fire.danger"]["providers"] == ["wadnr-fire-danger"]
    for contract in ("outages.areas", "traffic.corridors", "roadwx.stations"):
        assert out["contracts"][contract]["reason"] == "not_in_pack"


def test_invalid_pack_fails_closed_instead_of_reverting_to_oregon():
    out = capabilities.build(SETTINGS, {}, region(["missing"]), installed())
    assert out["pack_errors"] == {"missing": "invalid_pack"}
    assert all(c["status"] == "none" for c in out["contracts"].values())


def test_outside_monitoring_area_disables_selected_provider():
    bbox = {"min_lat": 39, "max_lat": 40, "min_lon": -106, "max_lon": -104}
    plan, _ = provider_plan(["oregon", "washington"], installed(), SETTINGS, bbox)
    assert all(p["reason"] == "outside_coverage" for p in plan.values())


def test_shared_flashalert_subscription_is_deduplicated():
    combined = combined_feeds(["oregon", "washington"], installed())
    assert len(combined["feeds"]["news"]) == 2
    assert len(combined["feeds"]["alerts"]) == 2
    raw = config_writer.merge_pack_feeds({}, combined)
    assert config_writer.merge_pack_feeds(raw, combined) == raw
    washington = config_writer.merge_pack_feeds(raw, combined_feeds(["washington"], installed()))
    assert washington["news_feeds"] == [] and len(washington["alert_feeds"]) == 1


@pytest.mark.parametrize("ids", [None, "oregon", ["none"], ["Bad Id"], ["x"], ["oregon"] * 9])
def test_invalid_multi_selection_is_rejected(ids):
    with pytest.raises(region_config.RegionError):
        region_config.normalize_packs(ids)


def test_normalize_preserves_legacy_single_pack_and_supports_multi():
    payload = {"name": "Example Metro", "lat": 45.5, "lon": -122.7, "timezone": "America/Los_Angeles"}
    assert region_config.normalize({**payload, "pack": "oregon"})["pack"] == "oregon"
    assert region_config.normalize({**payload, "packs": ["oregon", "washington", "oregon"]})["packs"] == ["oregon", "washington"]
    assert region_config.normalize({**payload, "packs": []})["pack"] == "none"
    with pytest.raises(region_config.RegionError):
        region_config.normalize({**payload, "packs": ["washington"], "pack": "oregon"})


@pytest.mark.asyncio
async def test_pack_only_endpoint_does_not_overwrite_env_pinned_region(tmp_path, monkeypatch):
    from routers import region as routes
    path = tmp_path / "sources.yml"
    path.write_text("{}")
    monkeypatch.setattr(config_writer, "CONFIG_PATH", path)
    monkeypatch.setattr(pack_registry, "valid_by_id", installed)
    monkeypatch.setattr(pack_selection, "sync_pack_feeds", AsyncMock())
    monkeypatch.setattr(routes, "load_effective", AsyncMock(return_value={"source": "env", "packs": ["oregon", "washington"]}))
    added = []
    db = SimpleNamespace(get=AsyncMock(return_value=None), execute=AsyncMock(), add=added.append,
                         commit=AsyncMock(), rollback=AsyncMock())
    result = await routes.set_packs(routes.PacksIn(packs=["oregon", "washington"]), db)
    assert result["source"] == "env"
    assert len(added) == 1 and added[0].key == "region_packs"
    assert added[0].value["packs"] == ["oregon", "washington"]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_packs_only_change_requires_restart_even_when_region_pinned(monkeypatch):
    from routers import setup
    selection = {"packs": ["oregon", "washington"], "feeds_signature": "fixture"}
    monkeypatch.setattr(setup, "load_effective", AsyncMock(return_value={"source": "env", "locked": True, "locked_by": ["REGION_LAT"], "pack": "oregon", "packs": selection["packs"]}))
    monkeypatch.setattr(setup, "load_stored", AsyncMock(return_value=(None, None)))
    monkeypatch.setattr(setup, "load_selection", AsyncMock(return_value=selection))
    state = {"state": "env", "packs_signature": "previous"}
    monkeypatch.setattr(setup, "_poller_state", AsyncMock(side_effect=lambda: state))
    assert (await setup.setup_status(None))["restart_required"] is True
    state["packs_signature"] = selection_signature(selection)
    assert (await setup.setup_status(None))["restart_required"] is False


@pytest.mark.asyncio
async def test_both_packs_suggested_for_border_monitoring_area(monkeypatch):
    from routers import setup
    monkeypatch.setattr(pack_registry, "installed", lambda: list(installed().values()))
    packs = await setup.list_packs(lat=45.5, lon=-122.7, state="OR", radius_km=60)
    assert {p["id"] for p in packs if p["suggested"]} == {"oregon", "washington"}


def test_missing_wsdot_key_keeps_dnr_fire_and_oregon_active():
    settings = SimpleNamespace(**{**vars(SETTINGS), 'wsdot_api_key': ''})
    out = capabilities.build(settings, {}, region(['oregon', 'washington']), installed())
    traffic = out['contracts']['traffic.incidents']
    assert traffic['providers'] == ['odot-tripcheck']
    assert traffic['provider_statuses']['wsdot-travel']['reason'] == 'not_configured'
    assert traffic['provider_statuses']['wsdot-travel']['requires'] == 'WSDOT_API_KEY'
    assert set(out['contracts']['fire.danger']['providers']) == {'odf-fire-danger', 'wadnr-fire-danger'}
