import logging
import httpx
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# Oregon OEM ODIN Outage ArcGIS API
_ODIN_URL = "https://services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/ODINPublicPoly_view/FeatureServer/0/query"

METRO_COUNTIES = {"MULTNOMAH", "WASHINGTON", "CLACKAMAS"}


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
                "outFields": "utilityName,metersOut,CountyName",
                "f": "json"
            }
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(_ODIN_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                
                features = data.get("features", [])
                if not features:
                    logger.debug("[utilities] No outage features returned from ODIN")
                    return

                state_total_affected = 0
                metro_total_affected = 0
                utility_stats = {}

                for feat in features:
                    attr = feat.get("attributes", {})
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

                await set_feed("utility:oregon", {
                    "provider": "Oregon ODIN",
                    "status": "Operational" if state_total_affected < 1000 else "Regional Outages",
                    "state_affected": state_total_affected,
                    "metro_affected": metro_total_affected,
                    "pge_affected": pge_data["affected"],
                    "pacificorp_affected": pac_data["affected"],
                    "utility_count": len(utility_stats),
                    "last_updated": "Just now",
                })

                # Maintain backward compatibility for the 'utility:pge' feed if frontend relies on it
                # We'll map the Portland General Electric data here.
                await set_feed("utility:pge", {
                    "provider": "PGE",
                    "status": "Operational" if pge_data["affected"] < 100 else "Outages Detected",
                    "active_outages": "—",  # ODIN doesn't provide incident count easily in this layer
                    "customers_affected": pge_data["affected"],
                    "last_updated": "Just now",
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
