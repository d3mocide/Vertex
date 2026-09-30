"""Reviewed built-in providers shared by capabilities and poller startup.

Manifests select these adapters; they never import or execute pack-supplied code.
"""
import hashlib
import json

SELECTION_KEY = "region_packs"
OREGON = (-124.7, 41.9, -116.4, 46.3)
WASHINGTON = (-124.8, 45.5, -116.9, 49.1)
PROVIDERS = {
    "odot-tripcheck": {"contracts": {"traffic.incidents": ["traffic:incidents"],
        "traffic.cameras": ["traffic:cameras"], "traffic.signs": ["traffic:signs"],
        "traffic.corridors": ["traffic:corridors", "traffic:flow"], "roadwx.stations": ["weather:rwis"]},
        "bbox": OREGON, "key": "odot_api_key", "key_env": "ODOT_API_KEY"},
    "oregon-odin": {"contracts": {"outages.areas": ["utility:outages", "utility:oregon", "utility:pge"]}, "bbox": OREGON},
    "odf-fire-danger": {"contracts": {"fire.danger": ["fire:danger"]}, "bbox": OREGON},
    "wsdot-travel": {"contracts": {"traffic.incidents": ["traffic:incidents"],
        "traffic.cameras": ["traffic:cameras"]}, "bbox": WASHINGTON, "key": "wsdot_api_key", "key_env": "WSDOT_API_KEY"},
    "wadnr-fire-danger": {"contracts": {"fire.danger": ["fire:danger"]}, "bbox": WASHINGTON},
}
CONTRACT_IDS = {c for spec in PROVIDERS.values() for c in spec["contracts"]}
LEGACY_PROVIDERS = ("odot-tripcheck", "oregon-odin", "odf-fire-danger")


def selected_ids(region):
    """None preserves legacy selection; [] means explicitly core-only."""
    if "packs" in region and region["packs"] is not None:
        return list(region["packs"])
    pack = region.get("pack")
    return None if pack is None else [] if pack == "none" else [pack]


def selection_signature(selection):
    return hashlib.sha256(json.dumps(selection, sort_keys=True).encode()).hexdigest()[:16]


def intersects(coverage, bbox):
    return (bbox["min_lon"] <= coverage[2] and bbox["max_lon"] >= coverage[0]
            and bbox["min_lat"] <= coverage[3] and bbox["max_lat"] >= coverage[1])


def provider_plan(ids, installed, settings, bbox):
    """Resolve provider IDs once, including disabled reasons and exact declared contracts."""
    declared = {}
    errors = {}
    if ids is None:
        declared = {pid: list(PROVIDERS[pid]["contracts"]) for pid in LEGACY_PROVIDERS}
    else:
        for pack_id in ids:
            pack = installed.get(pack_id)
            if not pack:
                errors[pack_id] = "invalid_pack"
                continue
            for provider in pack["providers"]:
                declared.setdefault(provider["id"], set()).update(provider["provides"])
    out = {}
    for pid, contracts in declared.items():
        spec = PROVIDERS.get(pid)
        reason = None
        if spec is None:
            reason = "unsupported_provider"
        elif not intersects(spec["bbox"], bbox):
            reason = "outside_coverage"
        elif spec.get("key") and not getattr(settings, spec["key"], ""):
            reason = "not_configured"
        supported = set(spec["contracts"]) if spec else set()
        out[pid] = {"id": pid, "contracts": sorted(set(contracts) & supported), "reason": reason,
                    "requires": spec.get("key_env") if spec and reason == "not_configured" else None}
    return out, errors


def combined_feeds(ids, installed):
    """Union feed defaults by URL in selection order; shared feeds are subscribed once."""
    feeds = {"news": [], "alerts": []}
    for kind in feeds:
        seen = set()
        for pid in ids:
            for feed in installed[pid].get("feeds", {}).get(kind, []):
                if feed["url"] not in seen:
                    feeds[kind].append(feed)
                    seen.add(feed["url"])
    return {"feeds": feeds}
