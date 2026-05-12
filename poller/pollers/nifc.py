import logging
import math
from datetime import datetime, timezone

import httpx

from bus import set_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

# NIFC WFIGS Interagency Perimeters (current year active fires)
_NIFC_BASE = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
    "/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"
)
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# Fields to request from ArcGIS REST API
_FIELDS = "IncidentName,GISAcres,DateCurrent,PercentContained,POOState,Agency"

# Expand bbox by this many degrees to catch perimeters partially inside region
_BBOX_EXPAND_DEG = 3.0


def _build_bbox() -> str:
    """Return xmin,ymin,xmax,ymax string expanded from region bbox."""
    min_lat = max(-90.0, settings.bbox_min_lat - _BBOX_EXPAND_DEG)
    max_lat = min(90.0,  settings.bbox_max_lat + _BBOX_EXPAND_DEG)
    min_lon = max(-180.0, settings.bbox_min_lon - _BBOX_EXPAND_DEG)
    max_lon = min(180.0,  settings.bbox_max_lon + _BBOX_EXPAND_DEG)
    return f"{min_lon},{min_lat},{max_lon},{max_lat}"


def _ms_to_iso(ms: int | None) -> str | None:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()
    except (OSError, OverflowError, ValueError):
        return None


def _centroid(coords_list) -> tuple[float, float] | None:
    """Return approximate centroid of first ring of a polygon/multipolygon."""
    try:
        # GeoJSON geometry.coordinates for Polygon: [[[lon,lat],...]]
        # For MultiPolygon: [[[[lon,lat],...]],...]; unwrap one level
        ring = coords_list
        while ring and isinstance(ring[0][0], list):
            ring = ring[0]
        if not ring:
            return None
        lons = [p[0] for p in ring if len(p) >= 2]
        lats = [p[1] for p in ring if len(p) >= 2]
        if not lons:
            return None
        return sum(lons) / len(lons), sum(lats) / len(lats)
    except (TypeError, IndexError):
        return None


class NifcPoller(BasePoller):
    name = "nifc"
    interval = 1800  # 30 minutes — perimeters update every 12-24 h operationally

    async def poll(self):
        bbox = _build_bbox()
        params = {
            "where": "1=1",
            "outFields": _FIELDS,
            "f": "geojson",
            "geometry": bbox,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "inSR": "4326",
            "outSR": "4326",
            "resultRecordCount": 500,
        }
        try:
            async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
                resp = await client.get(_NIFC_BASE, params=params)
                resp.raise_for_status()
                geojson = resp.json()
        except Exception as exc:
            logger.warning("[nifc] fetch failed: %s", exc)
            return

        features = geojson.get("features") or []
        enriched: list[dict] = []
        for f in features:
            props = f.get("properties") or {}
            geom  = f.get("geometry") or {}

            name = (props.get("IncidentName") or "Unknown Fire").strip()
            acres = props.get("GISAcres")
            contained = props.get("PercentContained")
            state = props.get("POOState") or ""
            agency = props.get("Agency") or ""
            date_ms = props.get("DateCurrent")

            centroid = _centroid(geom.get("coordinates", []))
            clon, clat = centroid if centroid else (None, None)

            enriched.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "name": name,
                    "acres": round(acres, 1) if acres is not None else None,
                    "contained_pct": contained,
                    "state": state,
                    "agency": agency,
                    "updated": _ms_to_iso(date_ms),
                    "centroid_lat": clat,
                    "centroid_lon": clon,
                },
            })

        payload = {"type": "FeatureCollection", "features": enriched}
        await set_feed("fire:perimeters", payload)
        logger.info("[nifc] stored %d fire perimeter(s)", len(enriched))
