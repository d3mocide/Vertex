import logging
import httpx
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# PGE Outage Map API
_PGE_SUMMARY_URL = "https://www.portlandgeneral.com/api/outage-map/outage-summary"


class UtilityPoller(BasePoller):
    name = "utilities"
    interval = 120  # Outage data is stable, 2m is fine

    async def setup(self):
        self._consecutive_failures = 0
        self._disabled_due_to_404 = False
        logger.info("[utilities] Utility poller initialized (PGE)")

    async def poll(self):
        if self._disabled_due_to_404:
            return

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

                if self._consecutive_failures > 0:
                    logger.info("[utilities] PGE outage feed recovered after %d failures", self._consecutive_failures)
                self._consecutive_failures = 0
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            self._consecutive_failures += 1
            if status == 404:
                self._disabled_due_to_404 = True
                logger.warning("[utilities] PGE outage endpoint returned 404; disabling PGE polling until restart")
                await set_feed("utility:pge", {
                    "provider": "PGE",
                    "status": "Unavailable",
                    "active_outages": 0,
                    "customers_affected": 0,
                    "last_updated": "—",
                    "reliability": None,
                })
                return

            if self._consecutive_failures in (1, 5, 15):
                logger.warning("[utilities] PGE outage fetch failed with HTTP %d", status)
            else:
                logger.debug("[utilities] PGE outage fetch still failing with HTTP %d", status)
        except httpx.HTTPError as exc:
            self._consecutive_failures += 1
            if self._consecutive_failures in (1, 5, 15):
                logger.warning("[utilities] PGE outage fetch failed (%s)", exc.__class__.__name__)
            else:
                logger.debug("[utilities] PGE outage fetch still failing (%s)", exc.__class__.__name__)
        except Exception as exc:
            self._consecutive_failures += 1
            if self._consecutive_failures in (1, 5, 15):
                logger.warning("[utilities] Unexpected PGE poller failure (%s)", exc.__class__.__name__)
            else:
                logger.debug("[utilities] Unexpected PGE poller failure (%s)", exc.__class__.__name__)
