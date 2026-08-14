"""
USGS Stream Gauge poller — fetches real-time streamflow and water level
readings from active gauging stations within the configured bounding box.

API: https://waterservices.usgs.gov/nwis/iv/
  parameterCd 00060 = Discharge (streamflow), ft³/s
  parameterCd 00065 = Gage height, ft
No API key required.

Publishes each active site as a `stream_gauge` entity so it appears
on the map with its current reading and status.
"""

import logging

import httpx

import math

from bus import publish_entity
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))

_USGS_IV_URL = "https://waterservices.usgs.gov/nwis/iv/"
_PARAMS = {
    "format":      "json",
    "parameterCd": "00060,00065",   # discharge + gage height
    "siteType":    "ST",
    "siteStatus":  "active",
}
_HEADERS = {"User-Agent": "Vertex/1.0 situational-awareness (github.com/vertex-project)"}
_ENTITY_TTL = 600    # 10 min — gauges are polled every 5 min

# USGS National Weather Service flood stage classifications (approximate thresholds)
# We use simple relative thresholds since absolute flood stages vary per site.
# Color classes: normal | elevated | minor | moderate | major
_FLOW_STAGE_THRESHOLDS = [500, 2000, 5000, 10000]  # ft³/s
_STAGE_LABELS = ["normal", "elevated", "minor flood", "moderate flood", "major flood"]


def _classify_flow(flow_cfs: float | None) -> str:
    if flow_cfs is None:
        return "unknown"
    for i, threshold in enumerate(_FLOW_STAGE_THRESHOLDS):
        if flow_cfs < threshold:
            return _STAGE_LABELS[i]
    return _STAGE_LABELS[-1]


class StreamGaugePoller(BasePoller):
    name     = "streamgauge"
    interval = 300   # 5-minute poll

    async def poll(self):
        bbox = (
            f"{settings.bbox_min_lon},{settings.bbox_min_lat},"
            f"{settings.bbox_max_lon},{settings.bbox_max_lat}"
        )
        params = {**_PARAMS, "bBox": bbox}

        try:
            async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
                resp = await client.get(_USGS_IV_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("[streamgauge] USGS fetch failed: %s", exc)
            return

        time_series = data.get("value", {}).get("timeSeries", [])
        # Group series by site number so we can combine discharge + gage height
        sites: dict[str, dict] = {}

        for series in time_series:
            src = series.get("sourceInfo") or {}
            geo = ((src.get("geoLocation") or {}).get("geogLocation")) or {}
            site_codes = src.get("siteCode") or []
            site_id = site_codes[0].get("value") if site_codes else None
            if not site_id:
                continue

            lat = geo.get("latitude")
            lon = geo.get("longitude")
            if lat is None or lon is None:
                continue

            if site_id not in sites:
                sites[site_id] = {
                    "site_id":   site_id,
                    "name":      src.get("siteName") or f"USGS {site_id}",
                    "lat":       float(lat),
                    "lon":       float(lon),
                    "flow_cfs":  None,
                    "height_ft": None,
                    "ts":        None,
                }

            var_code_list = (series.get("variable") or {}).get("variableCode") or []
            var_code = var_code_list[0].get("value") if var_code_list else ""
            values_block = (series.get("values") or [{}])[0]
            readings = values_block.get("value") or []

            if readings:
                latest = readings[-1]
                raw_val = latest.get("value")
                ts_str  = latest.get("dateTime")
                try:
                    val = float(raw_val)
                    if var_code == "00060":
                        sites[site_id]["flow_cfs"] = val
                    elif var_code == "00065":
                        sites[site_id]["height_ft"] = val
                    if ts_str and sites[site_id]["ts"] is None:
                        sites[site_id]["ts"] = ts_str
                except (TypeError, ValueError):
                    pass

        published = 0
        for site in sites.values():
            flow = site["flow_cfs"]
            stage = _classify_flow(flow)
            entity = {
                "entity_id":    f"usgs:gauge:{site['site_id']}",
                "entity_type":  "stream_gauge",
                "source":       "usgs",
                "display_name": site["name"],
                "lat":          site["lat"],
                "lon":          site["lon"],
                "status":       stage,
                "distance_km":  round(_distance_km(settings.region_lat, settings.region_lon, site["lat"], site["lon"]), 2),
                "identity": {
                    "site_id":   site["site_id"],
                    "flow_cfs":  flow,
                    "height_ft": site["height_ft"],
                    "stage":     stage,
                    "last_reading_ts": site["ts"],
                },
                "tags": ["usgs", "stream_gauge", "hydrology"],
            }
            await publish_entity(entity, ttl=_ENTITY_TTL)
            published += 1

        if published:
            logger.info("[streamgauge] published %d stream gauges", published)
