from __future__ import annotations

import math
from typing import Optional


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0088

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat_rad = math.radians(lat2 - lat1)
    dlon_rad = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat_rad / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon_rad / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the initial bearing (0–360°) from (lat1,lon1) to (lat2,lon2)."""
    φ1 = math.radians(lat1)
    φ2 = math.radians(lat2)
    Δλ = math.radians(lon2 - lon1)
    Δψ = math.log(math.tan(φ2 / 2 + math.pi / 4) / math.tan(φ1 / 2 + math.pi / 4))
    θ = math.atan2(Δλ, Δψ) * 180 / math.pi
    return (θ + 360) % 360


def project_position(
    lat: float,
    lon: float,
    heading_deg: float | None,
    speed_kt: float | None,
    elapsed_seconds: float,
) -> tuple[float, float] | None:
    if heading_deg is None or speed_kt is None:
        return None
    if speed_kt <= 0 or elapsed_seconds <= 0:
        return None

    distance_km = float(speed_kt) * 0.000514444 * float(elapsed_seconds)
    if distance_km <= 0:
        return None

    earth_radius_km = 6371.0088
    angular_distance = distance_km / earth_radius_km

    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    brng = math.radians(float(heading_deg) % 360.0)

    sin_lat2 = math.sin(lat1) * math.cos(angular_distance) + math.cos(lat1) * math.sin(angular_distance) * math.cos(brng)
    lat2 = math.asin(max(-1.0, min(1.0, sin_lat2)))
    lon2 = lon1 + math.atan2(
        math.sin(brng) * math.sin(angular_distance) * math.cos(lat1),
        math.cos(angular_distance) - math.sin(lat1) * math.sin(lat2),
    )

    lat_deg = math.degrees(lat2)
    lon_deg = ((math.degrees(lon2) + 540.0) % 360.0) - 180.0
    return lat_deg, lon_deg
