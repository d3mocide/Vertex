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


def resolve(contract: Contract, settings, feed_ages: dict[str, float], center: tuple[float, float] | None = None) -> dict:
    """Status of one contract: ok, stale, down, pending (enabled, no data yet) or none (no provider applies)."""
    out = {"title": contract.title, "providers": [], "status": "none", "reason": None, "updated_age_s": None}
    lat, lon = center if center else (settings.region_lat, settings.region_lon)

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


def build(settings, feed_ages: dict[str, float], region: dict | None = None) -> dict:
    """The capabilities document. `region` is the effective region (region_config.effective);
    without it the region comes straight from settings."""
    if region is None:
        region = {
            "name": settings.region_name,
            "center": [settings.region_lat, settings.region_lon],
            "bbox": {"min_lat": settings.bbox_min_lat, "max_lat": settings.bbox_max_lat,
                     "min_lon": settings.bbox_min_lon, "max_lon": settings.bbox_max_lon},
            "timezone": settings.region_timezone,
        }
    center = (region["center"][0], region["center"][1])
    return {
        "region": {k: region[k] for k in ("name", "center", "bbox", "timezone")},
        "pack": None,  # region packs are not implemented yet; providers are built in
        "contracts": {c.id: resolve(c, settings, feed_ages, center) for c in CONTRACTS},
    }
