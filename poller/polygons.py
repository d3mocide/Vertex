"""Polygon helpers shared by the zone-based providers (fire danger and similar)."""
import math


def rings(geometry: dict) -> list[list[list[float]]]:
    """Outer + inner rings of a Polygon/MultiPolygon as flat ring lists."""
    coords = geometry.get("coordinates") or []
    polys = [coords] if geometry.get("type") == "Polygon" else coords
    return [ring for poly in polys for ring in poly]


def inside(lat: float, lon: float, geometry: dict) -> bool:
    """Even-odd point-in-polygon over all rings (holes toggle the result back)."""
    result = False
    for ring in rings(geometry):
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                result = not result
    return result


def _segment_km(lat: float, lon: float, a: list[float], b: list[float]) -> float:
    """Distance from a point to the segment a-b ([lon, lat] pairs), on a plane local to the point."""
    kx = 111.32 * math.cos(math.radians(lat))
    ax, ay = (a[0] - lon) * kx, (a[1] - lat) * 110.57
    bx, by = (b[0] - lon) * kx, (b[1] - lat) * 110.57
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / length2))
    return math.hypot(ax + t * dx, ay + t * dy)


def distance_km(lat: float, lon: float, geometry: dict) -> float:
    """Distance to the nearest point on any zone edge. Vertices alone are not enough: a county or state line can be a
    single straight edge a hundred kilometres long, with its nearest point nowhere near either end."""
    best = float("inf")
    for ring in rings(geometry):
        for i in range(len(ring)):
            best = min(best, _segment_km(lat, lon, ring[i], ring[(i + 1) % len(ring)]))
    return best


def valid_polygon(geometry) -> bool:
    """A Polygon/MultiPolygon whose rings have at least four finite, in-range points."""
    if not isinstance(geometry, dict) or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
        return False
    try:
        found = rings(geometry)
        return bool(found) and all(
            len(ring) >= 4 and all(len(p) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                                                      for v in p[:2]) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in ring)
            for ring in found)
    except (TypeError, IndexError):
        return False
