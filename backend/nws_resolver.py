"""Turn a latitude/longitude into the NWS identifiers the app needs (US locations only).

Uses the public api.weather.gov ``points`` endpoint: forecast office, forecast and county zone IDs, fire
weather zone, timezone and the nearest city. Nothing here is persisted; the setup flow shows the result
to the operator, who confirms it before it is saved as the region.
"""
from __future__ import annotations

import asyncio
import math
import re
import httpx

from region_config import DEFAULT_RADIUS_KM, bbox_from_radius

NWS_POINTS_URL = "https://api.weather.gov/points/{lat},{lon}"
_HEADERS = {"User-Agent": "Vertex/1.0 (situational awareness dashboard)", "Accept": "application/geo+json"}


class ResolveError(Exception):
    """NWS could not resolve the location (outside US coverage, or the service failed)."""


def _last_segment(url: str | None) -> str | None:
    return url.rstrip("/").split("/")[-1] if url else None


def station_choices(payload, lat, lon, locations):
    """Rank valid nearby observation stations; climate IDs must exist in NWS's CF6 inventory."""
    stations = {}
    for feature in payload.get('features') or []:
        if not isinstance(feature, dict):
            continue
        props, geom = feature.get('properties') or {}, feature.get('geometry') or {}
        ident, coords = props.get('stationIdentifier'), geom.get('coordinates')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Z0-9]{3,5}', ident):
            continue
        if geom.get('type') != 'Point' or not isinstance(coords, list) or len(coords) < 2:
            continue
        x, y = coords[:2]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (x, y)):
            continue
        if not (-180 <= x <= 180 and -90 <= y <= 90):
            continue
        a = math.sin(math.radians(y-lat)/2)**2 + math.cos(math.radians(lat))*math.cos(math.radians(y))*math.sin(math.radians(x-lon)/2)**2
        distance = 6371 * 2 * math.asin(math.sqrt(min(1, a)))
        if distance <= 200:
            stations[ident] = distance
    ranked = sorted(stations, key=stations.get)
    climate = next((code for sid in ranked for code in (sid, sid[1:] if len(sid) == 4 else sid)
                    if re.fullmatch(r'[A-Z0-9]{3}', code) and code in locations), None)
    return {'station_primary': ranked[0] if ranked else '',
            'station_secondary': ranked[1] if len(ranked) > 1 else '',
            'nearby_stations': ranked[1:7], 'climate_station': climate or ''}


async def resolve_stations(props, lat, lon, client):
    url = props.get('observationStations')
    empty = station_choices({}, lat, lon, {})
    if not isinstance(url, str) or not re.fullmatch(r'https://api\.weather\.gov/gridpoints/[A-Z]{3}/-?\d+,-?\d+/stations', url):
        return {**empty, 'station_warning': 'Nearby weather stations could not be resolved.'}
    async def fetch(endpoint):
        try:
            result = await client.get(endpoint, headers=_HEADERS)
            result.raise_for_status()
            data = result.json()
            return data if isinstance(data, dict) else {}
        except (httpx.HTTPError, ValueError):
            return {}
    stations, products = await asyncio.gather(fetch(url), fetch('https://api.weather.gov/products/types/CF6/locations'))
    out = station_choices(stations, lat, lon, products.get('locations') or {})
    if not out['station_primary']:
        out['station_warning'] = 'Nearby weather stations could not be resolved.'
    elif not out['climate_station']:
        out['station_warning'] = 'No nearby climate station was confirmed by the NWS; climate products will be unavailable.'
    return out


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
    station_info = await resolve_stations(props, lat, lon, client)
    return {
        **station_info,
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
