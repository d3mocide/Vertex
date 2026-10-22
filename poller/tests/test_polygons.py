"""Polygon helpers behind the zone-based providers."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import polygons                                           # noqa: E402

# A zone with one 200 km straight southern edge and nothing but its corners as vertices.
LONG_EDGE = {"type": "Polygon", "coordinates": [[[-124.0, 45.0], [-121.0, 45.0], [-121.0, 46.0], [-124.0, 46.0], [-124.0, 45.0]]]}


def test_distance_is_to_the_nearest_edge_not_the_nearest_corner():
    # 0.1 degree (about 11 km) south of the middle of the edge; the nearest corner is about 120 km away.
    d = polygons.distance_km(44.9, -122.5, LONG_EDGE)
    assert 10 < d < 12


def test_distance_to_a_corner_and_inside():
    assert 0 < polygons.distance_km(44.9, -125.0, LONG_EDGE) < 120
    assert polygons.inside(45.5, -122.5, LONG_EDGE) and not polygons.inside(44.9, -122.5, LONG_EDGE)
    assert polygons.distance_km(45.5, -122.5, {"type": "Polygon", "coordinates": []}) == float("inf")
