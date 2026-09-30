"""Runtime region configuration: where the operator is, and how the rest of the app learns it.

Precedence: environment variables (REGION_LAT / REGION_LON set) > the value stored in the database >
built-in defaults. Existing deployments therefore keep working unchanged; a region chosen in the app
is stored in ``app_settings`` and picked up by the backend on the next request and by the poller on
its next check. See docs/architecture/region-packs.md.
"""
from __future__ import annotations

import math
from zoneinfo import ZoneInfo

REGION_KEY = "region"
DEFAULT_RADIUS_KM = 60.0
MIN_RADIUS_KM, MAX_RADIUS_KM = 5.0, 500.0
_ENV_LOCK_FIELDS = ("region_lat", "region_lon")


class RegionError(ValueError):
    """The submitted region is not valid."""


def bbox_from_radius(lat: float, lon: float, radius_km: float) -> dict:
    """Bounding box roughly `radius_km` around a point (longitude span widened by latitude)."""
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.05))
    return {
        "min_lat": round(lat - dlat, 4), "max_lat": round(lat + dlat, 4),
        "min_lon": round(lon - dlon, 4), "max_lon": round(lon + dlon, 4),
    }


def env_locked_by(settings) -> list[str]:
    """Environment variables that pin the region (empty when the region may be changed in the app)."""
    fields_set = getattr(settings, "model_fields_set", set())
    return [f.upper() for f in _ENV_LOCK_FIELDS if f in fields_set]


def effective(settings, stored: dict | None, updated_at: str | None = None) -> dict:
    """The region the app should use right now, and where it came from."""
    locked_by = env_locked_by(settings)
    if locked_by:
        source = "env"
    elif stored:
        source = "database"
    else:
        source = "default"

    if source == "database":
        r = stored
        center = [r["lat"], r["lon"]]
        bbox = r["bbox"]
        name = r.get("name") or settings.region_name
        timezone = r.get("timezone") or settings.region_timezone
        nws = r.get("nws")
    else:
        center = [settings.region_lat, settings.region_lon]
        bbox = {"min_lat": settings.bbox_min_lat, "max_lat": settings.bbox_max_lat,
                "min_lon": settings.bbox_min_lon, "max_lon": settings.bbox_max_lon}
        name, timezone, nws = settings.region_name, settings.region_timezone, None

    return {
        "name": name, "center": center, "bbox": bbox, "timezone": timezone, "nws": nws,
        "source": source,
        "locked": bool(locked_by), "locked_by": locked_by,
        "configured": source != "default",
        "updated_at": updated_at if source == "database" else None,
    }


def normalize(payload: dict) -> dict:
    """Validate a submitted region and return the stored form. Raises RegionError."""
    try:
        lat, lon = float(payload["lat"]), float(payload["lon"])
    except (KeyError, TypeError, ValueError):
        raise RegionError("lat and lon are required numbers") from None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise RegionError("lat must be within ±90 and lon within ±180")

    name = str(payload.get("name") or "").strip()
    if not (1 <= len(name) <= 64):
        raise RegionError("name is required (1-64 characters)")

    timezone = str(payload.get("timezone") or "").strip()
    try:
        ZoneInfo(timezone)
    except Exception:
        raise RegionError("timezone must be an IANA name such as America/Denver") from None

    if payload.get("bbox"):
        b = payload["bbox"]
        try:
            bbox = {k: float(b[k]) for k in ("min_lat", "max_lat", "min_lon", "max_lon")}
        except (KeyError, TypeError, ValueError):
            raise RegionError("bbox needs min_lat, max_lat, min_lon, max_lon") from None
        if not (bbox["min_lat"] < bbox["max_lat"] and bbox["min_lon"] < bbox["max_lon"]):
            raise RegionError("bbox minimums must be below maximums")
        if not (bbox["min_lat"] <= lat <= bbox["max_lat"] and bbox["min_lon"] <= lon <= bbox["max_lon"]):
            raise RegionError("the center must be inside the bounding box")
    else:
        try:
            radius = float(payload.get("radius_km", DEFAULT_RADIUS_KM))
        except (TypeError, ValueError):
            raise RegionError("radius_km must be a number") from None
        if not (MIN_RADIUS_KM <= radius <= MAX_RADIUS_KM):
            raise RegionError(f"radius_km must be between {MIN_RADIUS_KM:g} and {MAX_RADIUS_KM:g}")
        bbox = bbox_from_radius(lat, lon, radius)

    out = {"name": name, "lat": lat, "lon": lon, "bbox": bbox, "timezone": timezone}
    nws = payload.get("nws")
    if isinstance(nws, dict):
        out["nws"] = {k: str(nws[k]) for k in ("office", "forecast_zone", "county_zone", "fire_zone") if nws.get(k)}
    return out
