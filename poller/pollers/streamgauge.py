"""
River gauge poller — official river stage and flood status from NOAA's
National Water Prediction Service (NWPS).

API: https://api.water.noaa.gov/nwps/v1/gauges (bbox query, no key)
  Each gauge reports observed stage (ft) and flow, the official flood
  category for its own flood stages (no_flooding / action / minor /
  moderate / major), the forecast crest category, and observation times.

Replaces the USGS legacy WaterServices feed, which (a) is being retired —
503s and timeouts even for single sites — and (b) was classified with fixed
flow thresholds for every river, so the Willamette at Portland (19,800 cfs,
normal) and the Columbia at Vancouver (122,000 cfs, normal) showed as
"major flood". Flood status now comes from NOAA's per-gauge flood stages.

Publishes each gauge as a `stream_gauge` entity.
"""

import logging
import math

import httpx

from bus import publish_entity, set_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_NWPS_GAUGES_URL = "https://api.water.noaa.gov/nwps/v1/gauges"
_HEADERS = {"User-Agent": "Vertex/1.0 situational-awareness"}
_ENTITY_TTL = 1800  # gauges report every 15-60 min; keep through a missed poll

# NWPS floodCategory -> stage label used by the map layer and panels.
_CATEGORY = {
    "no_flooding":     "normal",
    "action":          "action",
    "minor":           "minor flood",
    "moderate":        "moderate flood",
    "major":           "major flood",
    "not_defined":     "no flood stages",
    "obs_not_current": "stale",
    "out_of_service":  "out of service",
}
# Worst-first, for summarising.
_SEVERITY = ["major flood", "moderate flood", "minor flood", "action"]


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _value(v):
    """NWPS uses -999 for 'no value'."""
    return None if v is None or v == -999 else v


def gauge_entity(g: dict) -> dict | None:
    """NWPS gauge record -> stream_gauge entity (None if unlocated)."""
    lat, lon = g.get("latitude"), g.get("longitude")
    if lat is None or lon is None or not g.get("lid"):
        return None
    status = g.get("status") or {}
    obs, fc = status.get("observed") or {}, status.get("forecast") or {}
    stage = _CATEGORY.get(obs.get("floodCategory"), "unknown")
    forecast_stage = _CATEGORY.get(fc.get("floodCategory"))
    height = _value(obs.get("primary")) if obs.get("primaryUnit") == "ft" else None
    flow = _value(obs.get("secondary"))
    if flow is not None and obs.get("secondaryUnit") == "kcfs":
        flow = flow * 1000
    return {
        "entity_id":    f"nwps:gauge:{g['lid']}",
        "entity_type":  "stream_gauge",
        "source":       "nwps",
        "display_name": g.get("name") or g["lid"],
        "lat":          float(lat),
        "lon":          float(lon),
        "status":       stage,
        # Real observation time, not our poll time.
        "last_seen":    obs.get("validTime"),
        "distance_km":  round(_distance_km(settings.region_lat, settings.region_lon, lat, lon), 2),
        "identity": {
            "lid":                g["lid"],
            "flow_cfs":           flow,
            "height_ft":          height,
            "gauge_height_ft":    height,   # key read by the entity detail panel
            "stage":              stage,
            "flood_category":     obs.get("floodCategory"),
            "forecast_stage":     forecast_stage,
            "forecast_height_ft": _value(fc.get("primary")) if fc.get("primaryUnit") == "ft" else None,
            "forecast_time":      fc.get("validTime"),
            "last_reading_ts":    obs.get("validTime"),
            "wfo":                (g.get("wfo") or {}).get("abbreviation"),
            "provider":           "NOAA NWPS",
        },
        "tags": ["nwps", "stream_gauge", "hydrology"],
    }


class StreamGaugePoller(BasePoller):
    name     = "streamgauge"
    interval = 600   # NWPS observations update every 15-60 min

    async def poll(self):
        params = {
            "bbox.xmin": settings.bbox_min_lon, "bbox.ymin": settings.bbox_min_lat,
            "bbox.xmax": settings.bbox_max_lon, "bbox.ymax": settings.bbox_max_lat,
            "srid": "EPSG_4326",
        }
        try:
            async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
                resp = await client.get(_NWPS_GAUGES_URL, params=params)
                resp.raise_for_status()
                gauges = resp.json().get("gauges") or []
        except Exception as exc:
            logger.warning("[streamgauge] NWPS fetch failed: %s", exc)
            return

        entities = [e for e in (gauge_entity(g) for g in gauges) if e]
        for entity in entities:
            await publish_entity(entity, ttl=_ENTITY_TTL)

        flooding = [e for e in entities if e["status"] in _SEVERITY]
        forecast = [e for e in entities if e["identity"]["forecast_stage"] in _SEVERITY]
        # Small summary feed for the briefing / UI: only gauges at or above action stage.
        await set_feed("hydro:status", {
            "gauges": len(entities),
            "observed_flooding": [{"name": e["display_name"], "stage": e["status"],
                                   "height_ft": e["identity"]["height_ft"], "time": e["last_seen"]}
                                  for e in sorted(flooding, key=lambda e: _SEVERITY.index(e["status"]))],
            "forecast_flooding": [{"name": e["display_name"], "stage": e["identity"]["forecast_stage"],
                                   "height_ft": e["identity"]["forecast_height_ft"],
                                   "time": e["identity"]["forecast_time"]}
                                  for e in sorted(forecast, key=lambda e: _SEVERITY.index(e["identity"]["forecast_stage"]))],
        }, broadcast=False)
        logger.info("[streamgauge] %d NWPS gauges (%d at/above action stage, %d forecast to)",
                    len(entities), len(flooding), len(forecast))
