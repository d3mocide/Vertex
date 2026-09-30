"""Tests for region packs: validation, discovery, matching, and how a chosen pack shapes capabilities.

Run from backend/:
    pytest tests/test_packs.py
"""
from __future__ import annotations

import copy
import os
import sys
from types import SimpleNamespace

_BACKEND_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

import pytest
import yaml

import capabilities as cap
import packs
import region_config as rc

CONTRACT_IDS = {c.id for c in cap.CONTRACTS}
REPO_REGIONS = os.path.join(_BACKEND_ROOT, "..", "regions")

GOOD = {
    "schema": 1, "id": "denver", "name": "Denver Metro", "description": "d", "maintainers": ["someone"],
    "covers": {"states": ["CO"], "bbox": [-105.7, 39.2, -104.3, 40.3]},
    "requires_keys": [{"name": "CDOT_API_KEY", "where": "https://example.invalid", "free": True,
                       "unlocks": ["traffic.incidents"]}],
    "providers": [{"id": "cdot", "kind": "builtin", "provides": ["traffic.incidents", "traffic.cameras"]}],
}


def _pack(**changes):
    m = copy.deepcopy(GOOD)
    for k, v in changes.items():
        if v is None:
            m.pop(k, None)
        else:
            m[k] = v
    return m


def _validate(m, dirname="denver"):
    return packs.validate(m, dirname, CONTRACT_IDS)


# ── validation ───────────────────────────────────────────────────────────────
def test_a_good_manifest_normalizes():
    p = _validate(GOOD)
    assert p["id"] == "denver" and p["provides"] == ["traffic.incidents", "traffic.cameras"]
    assert p["covers"]["bbox"] == [-105.7, 39.2, -104.3, 40.3]
    assert p["requires_keys"][0]["unlocks"] == ["traffic.incidents"]


@pytest.mark.parametrize("feeds", [[], False, "rss", {"newz": []}, {"news": "rss"},
    {"news": [{"name": "News", "url": "https://example.invalid", "format": []}]},
    {"news": [{"name": "News", "url": "http://localhost/feed"}]},
    {"news": [{"name": "News", "url": "http://[::1]/feed"}]},
    {"news": [{"name": "News", "url": "https://user:credential@example.invalid/feed"}]},
    {"news": [{"name": "News", "url": "https://example.invalid:bad/feed"}]},
    {"news": [{"name": "News", "url": "https://example.invalid"}] * 2},
    {"news": [{"name": "News", "url": "https://example.invalid"}] * 26},
])
def test_malformed_or_unsafe_pack_feeds_are_rejected(feeds):
    with pytest.raises(packs.PackError):
        _validate(_pack(feeds=feeds))


def test_optional_pack_feeds_normalize_default_formats():
    assert _validate(GOOD)["feeds"] == {"news": [], "alerts": []}
    p = _validate(_pack(feeds={"news": [{"name": "News", "url": "https://example.invalid/feed"}]}))
    assert p["feeds"]["news"][0]["format"] == "rss"


@pytest.mark.parametrize("bad, why", [
    (_pack(schema=2), "schema"),
    (_pack(id="Bad Id"), "id must"),
    (_pack(id="other"), "directory"),
    (_pack(name=""), "name"),
    (_pack(covers={}), "covers needs"),
    (_pack(covers={"states": ["Colorado"]}), "state codes"),
    (_pack(covers={"bbox": [1, 2, 3]}), "bbox"),
    (_pack(covers={"bbox": [-104, 39, -105, 40]}), "impossible"),
    (_pack(requires_keys=[{"name": "lowercase"}]), "environment variable"),
    (_pack(requires_keys=[{"name": "A_KEY"}, {"name": "A_KEY"}]), "duplicate key"),
    (_pack(requires_keys=[{"name": "A_KEY", "unlocks": ["made.up"]}]), "unknown contract"),
    (_pack(providers=[]), "at least one provider"),
    (_pack(providers=[{"id": "prov", "kind": "gtfs_rt", "provides": ["traffic.incidents"]}]), "not supported yet"),
    (_pack(providers=[{"id": "prov", "kind": "builtin", "provides": []}]), "at least one contract"),
    (_pack(providers=[{"id": "prov", "kind": "builtin", "provides": ["nope.nope"]}]), "unknown contract"),
    (_pack(providers=[{"id": "prov", "kind": "builtin", "provides": ["fire.danger"]}] * 2), "duplicate provider"),
])
def test_bad_manifests_are_rejected_with_a_reason(bad, why):
    with pytest.raises(packs.PackError, match=why):
        _validate(bad)


@pytest.mark.parametrize("leak", ["http://192.168.1.20/feed", "/home/someone/data", "me@example.com", "10.0.0.5"])
def test_packs_may_not_contain_private_addresses_paths_or_emails(leak):
    with pytest.raises(packs.PackError, match="private"):
        _validate(_pack(description=f"see {leak}"))


# ── discovery ────────────────────────────────────────────────────────────────
def _write(tmp_path, name, manifest_text):
    d = tmp_path / name
    d.mkdir()
    (d / "pack.yml").write_text(manifest_text)


def test_discovery_lists_valid_and_invalid_packs_and_skips_underscore_dirs(tmp_path):
    _write(tmp_path, "denver", yaml.safe_dump(GOOD))
    _write(tmp_path, "broken", "schema: 1\nid: broken\n")
    _write(tmp_path, "_template", yaml.safe_dump(GOOD))
    (tmp_path / "nomanifest").mkdir()
    (tmp_path / "junk.yml").write_text("x")
    found = {p["id"]: p for p in packs.discover(tmp_path, CONTRACT_IDS)}
    assert set(found) == {"denver", "broken", "nomanifest"}
    assert found["denver"]["valid"] is True
    assert found["broken"]["valid"] is False and found["broken"]["error"]
    assert found["nomanifest"]["error"] == "missing pack.yml"


def test_bad_yaml_is_reported_not_raised(tmp_path):
    _write(tmp_path, "denver", "id: [unclosed")
    (p,) = packs.discover(tmp_path, CONTRACT_IDS)
    assert p["valid"] is False


def test_missing_directory_means_no_packs(tmp_path):
    assert packs.discover(tmp_path / "nope", CONTRACT_IDS) == []


def test_the_shipped_packs_are_valid():
    if not os.path.isdir(REPO_REGIONS):
        pytest.skip("regions/ not available in this checkout")
    found = packs.discover(REPO_REGIONS, CONTRACT_IDS)
    assert {p["id"] for p in found} >= {"oregon"}
    assert all(p["valid"] for p in found), [p for p in found if not p["valid"]]


def test_the_template_pack_passes_the_same_checks():
    path = os.path.join(REPO_REGIONS, "_template", "pack.yml")
    if not os.path.isfile(path):
        pytest.skip("regions/ not available in this checkout")
    m = yaml.safe_load(open(path))
    packs.validate({**m, "id": "your-area"}, "your-area", CONTRACT_IDS)


# ── matching and keys ────────────────────────────────────────────────────────
def test_covers_point_by_bbox_or_state():
    p = _validate(GOOD)
    assert packs.covers_point(p, 39.74, -104.99)
    assert not packs.covers_point(p, 45.5, -122.7)
    assert packs.covers_point(p, 45.5, -122.7, state="co")       # outside the box, but the state matches
    assert not packs.covers_point(p, 45.5, -122.7, state="OR")


def test_key_status_reports_presence_never_values():
    p = _validate(GOOD)
    (absent,) = packs.key_status(p, {})
    assert absent["present"] is False and absent["name"] == "CDOT_API_KEY"
    (present,) = packs.key_status(p, {"CDOT_API_KEY": "s3cret-value"})
    assert present["present"] is True and "s3cret-value" not in str(present)
    assert packs.key_status(p, {"CDOT_API_KEY": ""})[0]["present"] is False


# ── region: pack field and shared signature ──────────────────────────────────
def _payload(**kw):
    p = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver"}
    p.update(kw)
    return p


def test_region_stores_a_pack_choice():
    assert rc.normalize(_payload(pack="denver"))["pack"] == "denver"
    assert rc.normalize(_payload(pack="none"))["pack"] == "none"
    assert "pack" not in rc.normalize(_payload())


@pytest.mark.parametrize("bad", ["Bad Id", "", 5, "x"])
def test_region_rejects_a_malformed_pack(bad):
    with pytest.raises(rc.RegionError):
        rc.normalize(_payload(pack=bad))


def test_signature_matches_the_poller_fingerprint():
    stored = {"name": "Denver, CO", "lat": 39.74, "lon": -104.99, "timezone": "America/Denver",
              "bbox": {"min_lat": 39.2, "max_lat": 40.3, "min_lon": -105.7, "max_lon": -104.3},
              "nws": {"office": "BOU"}}
    assert rc.signature(stored) == "68d749c25f8b47d8"   # same literal as poller/tests/test_region_sync.py


# ── capabilities follows the chosen pack ─────────────────────────────────────
def _settings():
    return SimpleNamespace(region_name="X", region_lat=45.5, region_lon=-122.7, region_timezone="America/Los_Angeles",
                           bbox_min_lat=45, bbox_max_lat=46, bbox_min_lon=-123, bbox_max_lon=-122, odot_api_key="k")


def _region(pack):
    return {"name": "X", "center": [45.5, -122.7], "bbox": {}, "timezone": "America/Los_Angeles", "pack": pack}


def test_legacy_install_keeps_every_builtin_provider():
    out = cap.build(_settings(), {}, _region(None), {})
    assert out["pack"] is None and all(v["status"] == "pending" for v in out["contracts"].values())


def test_core_only_choice_turns_regional_contracts_off():
    out = cap.build(_settings(), {}, _region("none"), {})
    assert out["pack"] == "none"
    assert all(v["status"] == "none" and v["reason"] == "no_pack" for v in out["contracts"].values())


def test_a_pack_only_enables_the_contracts_its_providers_provide():
    manifest = copy.deepcopy(GOOD)
    manifest["providers"][0]["id"] = "odot-tripcheck"
    pack = _validate(manifest)
    out = cap.build(_settings(), {}, _region("denver"), {"denver": pack})
    c = out["contracts"]
    assert c["traffic.incidents"]["status"] == "pending"           # in the pack (and the key is present)
    assert c["traffic.cameras"]["status"] == "pending"
    assert c["fire.danger"]["status"] == "none" and c["fire.danger"]["reason"] == "not_in_pack"
    assert c["outages.areas"]["reason"] == "not_in_pack"
