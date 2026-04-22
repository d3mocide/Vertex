import logging
import httpx
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# PGE Outage Map API
_PGE_SUMMARY_URL = "https://www.portlandgeneral.com/api/outage-map/outage-summary"


class UtilityPoller(BasePoller):
    name = "utilities"
    interval = 120  # Outage data is stable, 2m is fine

    async def setup(self):
        logger.info("[utilities] Utility poller initialized (PGE)")

    async def poll(self):
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "application/json",
                    "Referer": "https://portlandgeneral.com/outages",
                    "X-Requested-With": "XMLHttpRequest",
                }
                resp = await client.get(_PGE_SUMMARY_URL, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                
                # The API returns: {"outageSummary": {"customersWithPower": 99.9, "customersAffected": 12, ...}}
                summary = data.get("outageSummary", {})
                
                await set_feed("utility:pge", {
                    "provider": "PGE",
                    "status": "Operational" if summary.get("customersWithPower", 100) > 99 else "Outages Detected",
                    "active_outages": summary.get("activeOutages", 0),
                    "customers_affected": summary.get("customersAffected", 0),
                    "last_updated": summary.get("lastUpdated", "—"),
                    "reliability": summary.get("customersWithPower", 100),
                })
        except Exception as exc:
            logger.warning("[utilities] PGE outage fetch failed: %s", exc)
