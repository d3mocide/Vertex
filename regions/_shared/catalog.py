"""Reviewed built-in providers shared by capabilities and poller startup.

Manifests select these adapters; they never import or execute pack-supplied code.
"""
import hashlib
import json
import os
from transit_sources import SOURCES

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
}
for pid, source in SOURCES.items():
    contracts = {"transit.routes": ["transit:routes"]}
    if source["realtime_url"]:
        contracts["transit.vehicles"] = ["transit:vehicles"]
    PROVIDERS[pid] = {"contracts": contracts, "bbox": source["bbox"],
                      **({"key": source["key"], "key_env": source["key"].upper()} if source.get("key") else {}),
                      "unavailable": source.get("unavailable"), "enabled_setting": source.get("enabled_setting")}
FEED_KEYS = {"fire.danger": ["fire:danger"]}      # feed keys of the contracts a declarative provider can fill
CONTRACT_IDS = {c for spec in PROVIDERS.values() for c in spec["contracts"]}
LEGACY_PROVIDERS = ("odot-tripcheck", "oregon-odin", "odf-fire-danger", "trimet-transit")


def declared_entries(pack, claimed=None):
    """Catalog entries a pack's declarative providers would add, as {provider id: entry}; changes nothing.

    A provider id may not replace a built-in or an already registered provider with different settings, nor one in
    ``claimed`` (entries of other packs in the same selection). Raises ValueError for a clash."""
    entries = {}
    for provider in pack.get("providers", []):
        if provider.get("kind") == "builtin":
            continue
        bbox = pack["covers"]["bbox"]
        spec = provider["spec"]
        if provider["kind"] == "gtfs_rt":
            contracts = {"transit.routes": ["transit:routes"]}
            if spec["realtime_url"]:
                contracts["transit.vehicles"] = ["transit:vehicles"]
            # An agency serves one area, not the whole state its pack covers: a narrower coverage keeps Vertex from
            # downloading the schedule of a transit agency hundreds of kilometres from the monitored area.
            entry = {"contracts": contracts, "bbox": tuple(spec["coverage"] or bbox), "kind": "gtfs_rt", "declarative": spec,
                     "attribution": spec["attribution"], **({"env_key": spec["key"]["env"]} if spec["key"] else {})}
        else:
            entry = {"contracts": {c: FEED_KEYS[c] for c in provider["provides"]}, "bbox": tuple(bbox),
                     "kind": provider["kind"], "declarative": spec, "attribution": spec["attribution"]}
        for other in (PROVIDERS, claimed or {}, entries):
            known = other.get(provider["id"])
            if known is not None and known != entry:
                raise ValueError(f"provider id {provider['id']!r} is already in use")
        entries[provider["id"]] = entry
    return entries


def register_declared(pack):
    """Add a pack's declarative providers (kind arcgis_featureserver, ...) to PROVIDERS from their validated manifest.

    The catalog stays the one place that answers "what does provider X provide, where, and what does it need"; a
    declarative provider is just an entry built from the manifest rather than written here. Only packs that are
    actually in use are registered (the provider plan does it); merely checking a choice must use declared_entries."""
    PROVIDERS.update(declared_entries(pack))


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
            try:
                register_declared(pack)
            except ValueError:
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
        elif spec.get("unavailable"):
            reason = spec["unavailable"]
        elif spec.get("enabled_setting") and not getattr(settings, spec["enabled_setting"], True):
            reason = "disabled"
        elif spec.get("key") and not getattr(settings, spec["key"], ""):
            reason = "not_configured"
        elif spec.get("env_key") and not os.environ.get(spec["env_key"]):
            reason = "not_configured"      # a pack-declared key lives in the environment, not in a Settings field
        supported = set(spec["contracts"]) if spec else set()
        out[pid] = {"id": pid, "contracts": sorted(set(contracts) & supported), "reason": reason,
                    "requires": (spec.get("key_env") or spec.get("env_key")) if spec and reason == "not_configured" else None}
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
