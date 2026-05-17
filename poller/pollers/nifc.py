import logging
import math
from datetime import datetime, timezone

import httpx

from bus import set_feed, get_bus
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

# NIFC WFIGS Interagency Perimeters (Year-to-Date active and recent fires)
_NIFC_BASE = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
    "/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0/query"
)
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# Fields to request from ArcGIS REST API
_FIELDS = "IncidentName,GISAcres,DateCurrent,PercentContained,POOState,Agency"

# Expand search area significantly for perimeters
_BBOX_EXPAND_DEG = 10.0


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
        # 1. Fetch perimeters within the expanded bbox (primary spatial sync)
        bbox = _build_bbox()
        spatial_params = {
            "where": "1=1",
            "geometry": bbox,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": _FIELDS,
            "f": "geojson",
            "outSR": "4326",
            "resultRecordCount": 500,
        }

        # 2. Determine which specific distant fires to fetch (targeted sync)
        from bus import get_bus
        import json
        redis = await get_bus()
        keys = await redis.keys("entity:fire:*")
        fire_names: set[str] = set()

        for k in keys:
            raw = await redis.get(k)
            if not raw: continue
            try:
                ent = json.loads(raw)
                name = ent.get("display_name")
                if name and name != "Wildfire":
                    clean_name = name.split(',')[0].replace(" WILDFIRE", "").replace(" FIRE", "").strip()
                    if clean_name:
                        fire_names.add(clean_name.upper())
            except: continue

        # Combine searches if we have distant fires to track
        features: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=40, headers=_HEADERS) as client:
                r1 = await client.get(_NIFC_BASE, params=spatial_params)
                r1.raise_for_status()
                data1 = r1.json()
                f1 = data1.get("features") or []
                features.extend(f1)
                logger.debug("[nifc] spatial sync returned %d features", len(f1))

                # supplement with distant named fires if any
                if fire_names:
                    names_str = ",".join([f"'{n}'" for n in fire_names])
                    name_params = {
                        "where": f"UPPER(IncidentName) IN ({names_str})",
                        "outFields": _FIELDS,
                        "f": "geojson",
                        "outSR": "4326",
                    }
                    r2 = await client.get(_NIFC_BASE, params=name_params)
                    if r2.status_code == 200:
                        data2 = r2.json()
                        f2 = data2.get("features") or []
                        features.extend(f2)
                        logger.debug("[nifc] name sync returned %d features", len(f2))
        except Exception as exc:
            logger.warning("[nifc] fetch failed: %s", exc)
            if not features: return

        if not features:
            logger.info("[nifc] zero perimeters returned from ArcGIS (spatial bbox: %s)", bbox)
            return

        # De-duplicate by a hash of geometry or incident ID if possible, 
        # but for GeoJSON results we'll just use a set of names+acres
        seen_ids = set()
        unique_features = []
        for f in features:
            props = f.get("properties") or {}
            fid = f"{props.get('IncidentName')}:{props.get('GISAcres')}"
            if fid in seen_ids: continue
            seen_ids.add(fid)
            unique_features.append(f)

        enriched: list[dict] = []
        for f in unique_features:
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
                    "acres": round(acres, 1) if isinstance(acres, (int, float)) else None,
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
        logger.info("[nifc] synced %d perimeter(s) (spatial + %d named fires)", len(enriched), len(fire_names))
