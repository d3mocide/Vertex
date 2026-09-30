"""Turn a latitude/longitude into the NWS identifiers the app needs (US locations only).

Uses the public api.weather.gov ``points`` endpoint: forecast office, forecast and county zone IDs, fire
weather zone, timezone and the nearest city. Nothing here is persisted; the setup flow shows the result
to the operator, who confirms it before it is saved as the region.
"""
from __future__ import annotations

import httpx

from region_config import DEFAULT_RADIUS_KM, bbox_from_radius

NWS_POINTS_URL = "https://api.weather.gov/points/{lat},{lon}"
_HEADERS = {"User-Agent": "Vertex/1.0 (situational awareness dashboard)", "Accept": "application/geo+json"}


class ResolveError(Exception):
    """NWS could not resolve the location (outside US coverage, or the service failed)."""


def _last_segment(url: str | None) -> str | None:
    return url.rstrip("/").split("/")[-1] if url else None


async def resolve(lat: float, lon: float, client: httpx.AsyncClient) -> dict:
    # api.weather.gov redirects when coordinates carry more than four decimals.
    url = NWS_POINTS_URL.format(lat=f"{lat:.4f}", lon=f"{lon:.4f}")
    try:
        resp = await client.get(url, headers=_HEADERS)
    except httpx.HTTPError as exc:
        raise ResolveError(f"Could not reach the National Weather Service: {type(exc).__name__}") from exc
    if resp.status_code in (404, 400):
        raise ResolveError("The National Weather Service has no coverage for this location (US only).")
    if resp.status_code != 200:
        raise ResolveError(f"The National Weather Service returned {resp.status_code}.")

    props = resp.json().get("properties", {})
    rel = (props.get("relativeLocation") or {}).get("properties", {})
    city, state = rel.get("city"), rel.get("state")
    return {
        "office": props.get("gridId"),
        "forecast_zone": _last_segment(props.get("forecastZone")),
        "county_zone": _last_segment(props.get("county")),
        "fire_zone": _last_segment(props.get("fireWeatherZone")),
        "timezone": props.get("timeZone"),
        "city": city,
        "state": state,
        "suggested_name": ", ".join(p for p in (city, state) if p) or None,
        "radius_km": DEFAULT_RADIUS_KM,
        "suggested_bbox": bbox_from_radius(lat, lon, DEFAULT_RADIUS_KM),
    }
