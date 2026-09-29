from datetime import datetime, timezone
import logging
import httpx
from config import settings
from security import validate_request_url
from bus import set_feed
from normalizers.beast_math import haversine_km
from .base import BasePoller

logger = logging.getLogger(__name__)

# Oregon OEM ODIN Outage ArcGIS API
_ODIN_URL = "https://services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/ODINPublicPoly_view/FeatureServer/0/query"

METRO_COUNTIES = {"MULTNOMAH", "WASHINGTON", "CLACKAMAS"}

_OUTAGE_MAP_KM = 150     # outage areas farther than this are not sent to the map
_OUTAGE_NEAR_KM = 30     # "near you" list


def _centroid(geometry: dict) -> tuple[float, float] | None:
    """Mean of the outer ring's vertices — good enough to say how far an outage area is."""
    try:
        coords = geometry["coordinates"]
        ring = coords[0] if geometry["type"] == "Polygon" else coords[0][0]
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        return lat, lon
    except (KeyError, IndexError, TypeError, ZeroDivisionError):
        return None


def summarize_outages(features: list[dict], lat: float, lon: float) -> tuple[list[dict], list[dict]]:
    """(map features within range, nearby list) from ODIN GeoJSON outage areas."""
    mapped: list[dict] = []
    near: list[dict] = []
    for f in features:
        p = f.get("properties") or {}
        geom = f.get("geometry")
        centre = _centroid(geom) if geom else None
        dist = round(haversine_km(centre[0], centre[1], lat, lon), 1) if centre else None
        entry = {
            "utility": (p.get("utilityName") or "Unknown").title(),
            "county": p.get("CountyName") or "",
            "meters_out": p.get("metersOut") or 0,
            "meters_served": p.get("metersServed"),
            "tract": p.get("tract"),
            "dist_km": dist,
        }
        if geom and dist is not None and dist <= _OUTAGE_MAP_KM:
            mapped.append({"type": "Feature", "geometry": geom, "properties": entry})
        if dist is not None and dist <= _OUTAGE_NEAR_KM and entry["meters_out"] > 0:
            near.append(entry)
    near.sort(key=lambda e: (e["dist_km"], -e["meters_out"]))
    return mapped, near


class UtilityPoller(BasePoller):
    name = "utilities"
    interval = 300  # 5 minutes is plenty for statewide aggregated data

    def __init__(self):
        self._consecutive_failures = 0

    async def setup(self):
        logger.info("[utilities] Utility poller initialized (Oregon ODIN)")

    async def poll(self):
        try:
            params = {
                "where": "1=1",
                "outFields": "utilityName,metersOut,metersServed,CountyName,tract",
                "f": "geojson",
                "outSR": 4326,
                "returnGeometry": "true",
                "geometryPrecision": 4,
                "maxAllowableOffset": 0.0005,   # ~50 m: invisible on a map, keeps the feed small
            }
            async with httpx.AsyncClient(
                timeout=20,
                follow_redirects=True,
                event_hooks={'request': [validate_request_url]}
            ) as client:
                resp = await client.get(_ODIN_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                
                features = data.get("features")
                if features is None:
                    # No "features" key at all means an error payload. An empty list is real:
                    # no outages anywhere, which must clear the previous counts.
                    logger.debug("[utilities] ODIN returned no feature list: %s", str(data)[:200])
                    return

                state_total_affected = 0
                metro_total_affected = 0
                utility_stats = {}

                for feat in features:
                    attr = feat.get("properties") or {}
                    utility = attr.get("utilityName", "Unknown")
                    affected = attr.get("metersOut") or 0
                    county = (attr.get("CountyName") or "").upper()

                    state_total_affected += affected
                    if county in METRO_COUNTIES:
                        metro_total_affected += affected

                    if utility not in utility_stats:
                        utility_stats[utility] = {"affected": 0, "counties": set()}
                    
                    utility_stats[utility]["affected"] += affected
                    if county:
                        utility_stats[utility]["counties"].add(county)

                # Find major utilities for the summary
                # (Focusing on PGE and Pacificorp as they are the primary ones for the user)
                pge_data = utility_stats.get("PORTLAND GENERAL ELECTRIC CO", {"affected": 0})
                pac_data = utility_stats.get("PACIFICORP", {"affected": 0})

                synced_at = datetime.now(timezone.utc).isoformat()
                mapped, near = summarize_outages(features, settings.region_lat, settings.region_lon)
                await set_feed("utility:outages", {"type": "FeatureCollection", "features": mapped, "near": near,
                                                   "updated": synced_at})
                await set_feed("utility:oregon", {
                    "provider": "Oregon ODIN",
                    "status": "Operational" if state_total_affected < 1000 else "Regional Outages",
                    "state_affected": state_total_affected,
                    "metro_affected": metro_total_affected,
                    "pge_affected": pge_data["affected"],
                    "pacificorp_affected": pac_data["affected"],
                    "utility_count": len(utility_stats),
                    "near": near,
                    "last_updated": synced_at,
                })

                # Maintain backward compatibility for the 'utility:pge' feed if frontend relies on it
                # We'll map the Portland General Electric data here.
                await set_feed("utility:pge", {
                    "provider": "PGE",
                    "status": "Operational" if pge_data["affected"] < 100 else "Outages Detected",
                    "active_outages": "—",  # ODIN doesn't provide incident count easily in this layer
                    "customers_affected": pge_data["affected"],
                    "last_updated": synced_at,
                    "reliability": None,
                })

                if self._consecutive_failures > 0:
                    logger.info("[utilities] Oregon ODIN feed recovered after %d failures", self._consecutive_failures)
                self._consecutive_failures = 0

        except Exception as exc:
            self._consecutive_failures += 1
            if self._consecutive_failures in (1, 5, 15):
                logger.warning("[utilities] Oregon ODIN fetch failed: %s", exc)
            else:
                logger.debug("[utilities] Oregon ODIN fetch still failing: %s", exc)
