"""
Oregon Department of Forestry fire danger by Regulated Use Area.

ODF publishes the current public fire danger level (1 Low … 4 Extreme) for each
of its ~63 protection zones as a public ArcGIS feature service (the one behind
gisapps.odf.oregon.gov/firerestrictions). It is the local, official read on
"how dry is it" — richer than a single AQI or an NWS fire-weather zone.

Published as feed:fire:danger: the zones as GeoJSON (for the map layer), plus
the zones nearest the region centre. Tualatin's valley floor sits in no ODF zone
(ODF protects the surrounding forestland), so "nearest" is what is useful.
"""

import logging
from datetime import datetime, timezone

import httpx

from bus import set_feed
from config import settings
from normalizers.beast_math import haversine_km
from .base import BasePoller

logger = logging.getLogger(__name__)

_URL = ("https://gis.odf.oregon.gov/odfags/rest/services/Hosted/"
        "Fire_Danger_Level_View/FeatureServer/0/query")
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}
_PARAMS = {
    "f": "geojson", "where": "1=1", "outSR": 4326, "returnGeometry": "true",
    "outFields": "district,regusearea,firedanger,pendingchangedatetime",
    # ~300 m vertex simplification: invisible at map scale, ~140 KB for all 63 zones.
    "geometryPrecision": 4, "maxAllowableOffset": 0.003,
}
DANGER_LABELS = {1: "Low", 2: "Moderate", 3: "High", 4: "Extreme"}
_NEARBY_KM = 120
_NEARBY_MAX = 4


def _rings(geometry: dict) -> list[list[list[float]]]:
    """Outer + inner rings of a Polygon/MultiPolygon as flat ring lists."""
    coords = geometry.get("coordinates") or []
    polys = [coords] if geometry.get("type") == "Polygon" else coords
    return [ring for poly in polys for ring in poly]


def _inside(lat: float, lon: float, geometry: dict) -> bool:
    """Even-odd point-in-polygon over all rings (holes toggle the result back)."""
    inside = False
    for ring in _rings(geometry):
        n = len(ring)
        for i in range(n):
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
            if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def _distance_km(lat: float, lon: float, geometry: dict) -> float:
    """Distance to the nearest zone vertex (edges are dense enough after simplification)."""
    return min(
        (haversine_km(pt[1], pt[0], lat, lon) for ring in _rings(geometry) for pt in ring),
        default=float("inf"),
    )


def summarise_danger(features: list[dict], lat: float, lon: float) -> dict:
    """The zone the point is in (if any) and the nearest few, nearest first."""
    zones = []
    home = None
    for f in features:
        p = f.get("properties") or {}
        level = p.get("firedanger")
        geom = f.get("geometry") or {}
        if level not in DANGER_LABELS or not geom:
            continue
        inside = _inside(lat, lon, geom)
        dist = 0.0 if inside else _distance_km(lat, lon, geom)
        entry = {
            "zone": p.get("regusearea"), "district": p.get("district"),
            "danger": level, "label": DANGER_LABELS[level], "dist_km": round(dist, 1),
        }
        if inside:
            home = entry
        if dist <= _NEARBY_KM:
            zones.append(entry)
    zones.sort(key=lambda z: z["dist_km"])
    return {"home": home, "nearby": zones[:_NEARBY_MAX]}


class OdfFireDangerPoller(BasePoller):
    name = "odf_fire_danger"
    interval = 1800   # levels change a few times a week; half an hour is ample

    async def poll(self):
        async with httpx.AsyncClient(timeout=60, headers=_HEADERS) as client:
            resp = await client.get(_URL, params=_PARAMS)
            resp.raise_for_status()
            collection = resp.json()
        features = collection.get("features") or []
        if not features:
            return
        summary = summarise_danger(features, settings.region_lat, settings.region_lon)
        await set_feed("fire:danger", {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": f.get("geometry"),
                 "properties": {"zone": (f.get("properties") or {}).get("regusearea"),
                                "danger": (f.get("properties") or {}).get("firedanger")}}
                for f in features if f.get("geometry")
            ],
            **summary,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })
