import json
import logging
import math
from urllib.parse import urlencode
from datetime import datetime, timedelta, timezone

import httpx

from bus import set_feed, get_bus
from config import settings
from arcgis import query_features
from .base import BasePoller

logger = logging.getLogger(__name__)

# NIFC WFIGS current interagency perimeters, shared across regional packs.
_NIFC_BASE = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services"
    "/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"
)
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# Fields to request from ArcGIS REST API
_FIELDS = "OBJECTID,poly_IRWINID,poly_IncidentName,poly_GISAcres,poly_DateCurrent,attr_PercentContained,attr_POOState,attr_POOProtectingAgency"

# Server-side geometry reduction: ~1 m coordinate precision and ~50 m
# vertex simplification — invisible at regional zoom, ~10x smaller payload.
_SIMPLIFY = {"geometryPrecision": 5, "maxAllowableOffset": 0.0005}

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


def _name_queries(names, where):
    """Keep encoded supplemental queries below upstream URL limits."""
    def params(batch):
        clause = ",".join("'" + name.replace("'", "''") + "'" for name in batch)
        return {"where": where + f" AND UPPER(poly_IncidentName) IN ({clause})",
                "outFields": _FIELDS, "f": "geojson", "outSR": "4326", **_SIMPLIFY}
    def fits(batch):
        # Reserve the largest pagination offset and the fields query_features adds.
        return len(urlencode({**params(batch), 'resultRecordCount': 1000,
                              'resultOffset': 20000, 'orderByFields': 'OBJECTID'})) <= 1500
    batch = []
    for name in sorted(names):
        if batch and not fits(batch + [name]):
            yield params(batch)
            batch = []
        if not fits([name]):
            raise ValueError('NIFC supplemental name exceeds query limit')
        batch.append(name)
    if batch:
        yield params(batch)


class NifcPoller(BasePoller):
    name = "nifc"
    interval = 1800  # 30 minutes — perimeters update every 12-24 h operationally

    async def poll(self):
        # 1. Fetch perimeters within the expanded bbox (primary spatial sync)
        bbox = _build_bbox()
        since = datetime.now(timezone.utc) - timedelta(days=settings.nifc_perimeter_max_age_days)
        spatial_params = {
            # Retain the operator-configured age limit within the current perimeter view.
            "where": f"attr_IncidentTypeCategory = 'WF' AND poly_DateCurrent >= TIMESTAMP '{since:%Y-%m-%d %H:%M:%S}'",
            "geometry": bbox,
            "geometryType": "esriGeometryEnvelope",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": _FIELDS,
            "f": "geojson",
            "inSR": "4326",
            "outSR": "4326",
            "resultRecordCount": 2000,
            **_SIMPLIFY,
        }

        # 2. Determine which specific distant fires to fetch (targeted sync)
        redis = await get_bus()
        keys = await redis.keys("entity:fire:*")
        fire_names: set[str] = set()
        west, south, east, north = map(float, bbox.split(","))

        for k in keys:
            raw = await redis.get(k)
            if not raw: continue
            try:
                ent = json.loads(raw)
                lat, lon = ent.get("lat"), ent.get("lon")
                if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lat, lon)):
                    if south <= lat <= north and west <= lon <= east:
                        continue  # The spatial request already covers this incident.
                name = ent.get("display_name")
                if name and name != "Wildfire":
                    # Uppercase BEFORE stripping suffixes — EONET titles are title-case
                    # ("Haystack Butte Wildfire"), and NIFC IncidentName omits the suffix.
                    clean_name = name.split(',')[0].upper().replace(" WILDFIRE", "").replace(" FIRE", "").strip()
                    if clean_name:
                        fire_names.add(clean_name)
            except (json.JSONDecodeError, TypeError, AttributeError): continue

        # Combine searches if we have distant fires to track
        features: list[dict] = []
        try:
            async with httpx.AsyncClient(timeout=40, headers=_HEADERS) as client:
                f1 = await query_features(client, _NIFC_BASE, spatial_params)
                features.extend(f1)
                logger.debug("[nifc] spatial sync returned %d features", len(f1))

                # supplement with distant named fires if any
                for name_params in _name_queries(fire_names, spatial_params["where"]):
                    features.extend(await query_features(client, _NIFC_BASE, name_params))
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("[nifc] fetch failed (%s)", type(exc).__name__)
            raise RuntimeError("NIFC perimeter fetch failed") from None

        if not features:
            # Successful query with zero results is a confirmed negative — write an
            # empty collection so consumers (AI summary) can distinguish "no
            # perimeters" from "feed never synced".
            logger.info("[nifc] zero current perimeters returned")
            await set_feed("fire:perimeters", {"type": "FeatureCollection", "features": []}, broadcast=False)
            return

        # De-duplicate by a hash of geometry or incident ID if possible, 
        # but for GeoJSON results we'll just use a set of names+acres
        seen_ids = set()
        unique_features = []
        for f in features:
            props = f.get("properties") or {}
            fid = props.get("OBJECTID") or json.dumps(f.get("geometry"), sort_keys=True)
            if fid in seen_ids: continue
            seen_ids.add(fid)
            unique_features.append(f)

        enriched: list[dict] = []
        for f in unique_features:
            props = f.get("properties") or {}
            geom  = f.get("geometry") or {}

            name = (props.get("poly_IncidentName") or "Unknown Fire").strip()
            acres = props.get("poly_GISAcres")
            contained = props.get("attr_PercentContained")
            state = props.get("attr_POOState") or ""
            agency = props.get("attr_POOProtectingAgency") or ""
            date_ms = props.get("poly_DateCurrent")

            centroid = _centroid(geom.get("coordinates", []))
            clon, clat = centroid if centroid else (None, None)

            enriched.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "name": name,
                    "irwin_id": props.get("poly_IRWINID"),
                    "attribution": "NIFC / WFIGS",
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
        # Not broadcast: the map fetches perimeters over REST when the layer is on.
        await set_feed("fire:perimeters", payload, broadcast=False)
        logger.info("[nifc] synced %d perimeter(s) (spatial + %d named fires)", len(enriched), len(fire_names))
