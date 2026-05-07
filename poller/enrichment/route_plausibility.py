from __future__ import annotations

from normalizers.beast_math import bearing_deg as _bearing_deg, haversine_km as _haversine_km


def is_route_plausible(
    *,
    lat: float | None,
    lon: float | None,
    origin_info: dict | None,
    dest_info: dict | None,
    heading_deg: float | None = None,
) -> bool:
    if lat is None or lon is None:
        return True

    o_lat, o_lon = _coord_pair(origin_info)
    d_lat, d_lon = _coord_pair(dest_info)
    if o_lat is None or o_lon is None or d_lat is None or d_lon is None:
        return True

    d_od = _haversine_km(o_lat, o_lon, d_lat, d_lon)
    d_ao = _haversine_km(lat, lon, o_lat, o_lon)
    d_ad = _haversine_km(lat, lon, d_lat, d_lon)

    # Corridor budget: reject only clear outliers far off the OD path.
    if d_ao + d_ad > d_od + max(400.0, d_od * 0.8):
        return False

    # Reject obviously unrelated routes where aircraft is far from both endpoints.
    if min(d_ao, d_ad) > max(1200.0, d_od * 2.5):
        return False

    # Optional heading sanity check when far from destination.
    if isinstance(heading_deg, (int, float)) and d_ad > 40.0:
        bearing_to_dest = _bearing_deg(lat, lon, d_lat, d_lon)
        if _heading_diff_deg(float(heading_deg), bearing_to_dest) > 165.0 and d_ao > (d_ad * 0.8):
            return False

    return True


def _coord_pair(info: dict | None) -> tuple[float | None, float | None]:
    if not isinstance(info, dict):
        return None, None
    lat = info.get("lat")
    lon = info.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None, None
    return float(lat), float(lon)


def _heading_diff_deg(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)
