"""Capability registry: which regional data contracts have a working provider here.

A *contract* is a normalized feed the UI depends on (for example ``traffic.incidents``); a *provider*
is the code that fills it from one upstream source. Today every provider is Oregon-specific and
built in; this registry is the seam that lets the UI adapt (hide what nothing feeds) and that region
packs will plug into later. See docs/architecture/region-packs.md.
"""
from __future__ import annotations

from dataclasses import dataclass

# Oregon, as (min_lon, min_lat, max_lon, max_lat).
OREGON_BBOX = (-124.7, 41.9, -116.4, 46.3)

# A contract counts as "down" once its data is this many times older than its stale threshold.
DOWN_FACTOR = 3


@dataclass(frozen=True)
class Contract:
    id: str
    title: str
    feeds: tuple[str, ...]           # Redis feed keys (feed:meta) that carry this contract
    provider: str                    # the built-in provider that fills it today
    max_age_s: int | None            # age after which the data is stale
    requires_key: str | None = None  # settings attribute holding a required API key
    key_env: str | None = None       # env var name to show the operator
    covers_bbox: tuple[float, float, float, float] | None = None


CONTRACTS: tuple[Contract, ...] = (
    Contract("transit.vehicles", "Live transit vehicles", ("transit:vehicles",), "trimet-transit", 90, "trimet_app_id", "TRIMET_APP_ID"),
    Contract("transit.routes", "Local transit routes", ("transit:routes",), "trimet-transit", 90000),
    Contract("traffic.incidents", "Road closures and delays", ("traffic:incidents",), "odot-tripcheck",
             600, "odot_api_key", "ODOT_API_KEY"),
    Contract("traffic.cameras", "Traffic cameras", ("traffic:cameras",), "odot-tripcheck",
             3600, "odot_api_key", "ODOT_API_KEY"),
    Contract("traffic.signs", "Message signs", ("traffic:signs",), "odot-tripcheck",
             900, "odot_api_key", "ODOT_API_KEY"),
    Contract("traffic.corridors", "Freeway corridors", ("traffic:corridors", "traffic:flow"), "odot-tripcheck",
             600, "odot_api_key", "ODOT_API_KEY"),
    Contract("roadwx.stations", "Road-weather stations", ("weather:rwis",), "odot-tripcheck",
             1500, "odot_api_key", "ODOT_API_KEY"),
    Contract("outages.areas", "Power outages", ("utility:outages", "utility:oregon"), "oregon-odin",
             1200, covers_bbox=OREGON_BBOX),
    Contract("fire.danger", "Fire danger", ("fire:danger",), "odf-fire-danger",
             5400, covers_bbox=OREGON_BBOX),
)


def _inside(bbox: tuple[float, float, float, float], lat: float, lon: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def resolve(contract: Contract, settings, feed_ages: dict[str, float], center: tuple[float, float] | None = None,
            pack: dict | str | None = None) -> dict:
    """Status of one contract: ok, stale, down, pending (enabled, no data yet) or none (no provider applies)."""
    out = {"title": contract.title, "providers": [], "status": "none", "reason": None, "updated_age_s": None}
    lat, lon = center if center else (settings.region_lat, settings.region_lon)

    # A region pack decides which providers are in play. No pack chosen (older installs, and installs
    # configured through the environment) keeps every built-in provider available.
    if pack == "none":
        out["reason"] = "no_pack"
        return out
    if isinstance(pack, dict):
        if not any(contract.id in p["provides"] for p in pack["providers"]):
            out["reason"] = "not_in_pack"
            return out

    if contract.covers_bbox and not _inside(contract.covers_bbox, lat, lon):
        out["reason"] = "outside_coverage"
        return out
    if contract.requires_key and not getattr(settings, contract.requires_key, ""):
        out["reason"] = "not_configured"
        out["requires"] = contract.key_env
        return out

    out["providers"] = [contract.provider]
    ages = [feed_ages[f] for f in contract.feeds if f in feed_ages]
    if not ages:
        out["status"] = "pending"
        return out

    age = min(ages)
    out["updated_age_s"] = round(age)
    if contract.max_age_s and age > contract.max_age_s * DOWN_FACTOR:
        out["status"] = "down"
    elif contract.max_age_s and age > contract.max_age_s:
        out["status"] = "stale"
    else:
        out["status"] = "ok"
    return out


def build(settings, feed_ages: dict[str, float], region: dict | None = None, packs: dict[str, dict] | None = None) -> dict:
    """Combine selected providers per contract, retaining each provider's health."""
    from provider_catalog import PROVIDERS, provider_plan, selected_ids
    if region is None:
        region = {"name": settings.region_name, "center": [settings.region_lat, settings.region_lon],
                  "bbox": {k: getattr(settings, "bbox_" + k) for k in ("min_lat", "max_lat", "min_lon", "max_lon")},
                  "timezone": settings.region_timezone}
    bbox = region.get("bbox") or {k: getattr(settings, "bbox_" + k) for k in ("min_lat", "max_lat", "min_lon", "max_lon")}
    ids = selected_ids(region)
    plan, errors = provider_plan(ids, packs or {}, settings, bbox)
    contracts = {}
    for contract in CONTRACTS:
        details = {}
        relevant = [p for p in plan.values() if contract.id in p["contracts"]]
        for provider in relevant:
            pid = provider["id"]
            if provider["reason"]:
                details[pid] = {"status": "none", "reason": provider["reason"], "requires": provider["requires"], "updated_age_s": None}
                continue
            feeds = PROVIDERS[pid]["contracts"][contract.id]
            ages = [feed_ages[f"provider:{pid}:{f}"] for f in feeds if f"provider:{pid}:{f}" in feed_ages]
            # Legacy installations have not published provider-specific metadata yet.
            if ids is None and not ages:
                ages = [feed_ages[f] for f in feeds if f in feed_ages]
            age = min(ages) if ages else None
            status = "pending" if age is None else "down" if contract.max_age_s and age > contract.max_age_s * DOWN_FACTOR else "stale" if contract.max_age_s and age > contract.max_age_s else "ok"
            details[pid] = {"status": status, "reason": None, "requires": None, "updated_age_s": round(age) if age is not None else None}
        active = [pid for pid, detail in details.items() if detail["status"] != "none"]
        reason = None
        if not active:
            reason = "no_pack" if ids == [] else "invalid_pack" if errors and not relevant else next((p["reason"] for p in relevant if p["reason"]), "not_in_pack")
        statuses = [details[pid]["status"] for pid in active]
        status = next((s for s in ("ok", "stale", "pending", "down") if s in statuses), "none")
        ages = [details[pid]["updated_age_s"] for pid in active if details[pid]["updated_age_s"] is not None]
        result = {"title": contract.title, "providers": active, "status": status, "reason": reason,
                  "updated_age_s": min(ages) if ages else None, "provider_statuses": details}
        if reason == "not_configured":
            result["requires"] = next((p["requires"] for p in relevant if p["requires"]), None)
        contracts[contract.id] = result
    return {"region": {k: region[k] for k in ("name", "center", "bbox", "timezone")},
            "pack": region.get("pack"), "packs": ids, "pack_errors": errors, "contracts": contracts}
