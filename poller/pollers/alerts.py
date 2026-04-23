import logging
import xml.etree.ElementTree as ET
import feedparser
import httpx
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# NWS CAP alerts API — no auth required, covers WA/Multnomah/Clackamas counties
_NWS_HEADERS = {"User-Agent": "CivicGrid/0.1 (civic-grid; contact@localhost)"}

# TVFR emergency alert RSS feed
_TVFR_RSS_URL = "https://www.tvfr.com/RSSFeed.aspx?ModID=63&CID=Emergency-Alert-3"

# FlashAlert Portland — emergency-only XML feed on flashalertnewswire.net
# Discovered via flashalert.net/xml-feeds.html (the old flashalert.net RSS URLs
# return 500 errors; this is the current working endpoint).
_FLASHALERT_EMERGENCY_URL = (
    "http://www.flashalertnewswire.net/IIN/reportsX/flashnews_xml_emergency.php"
)

# Reliable way to strip the FlashAlert proprietary DTD: slice from the root element.
# The root is always <flashnews ...>, so we find it and discard the preamble.
def _strip_flashalert_dtd(text: str) -> str:
    idx = text.find("<flashnews")
    if idx == -1:
        raise ValueError("No <flashnews> root element found in FlashAlert XML")
    # Prepend the XML declaration so ElementTree gets a valid document
    return '<?xml version="1.0" encoding="UTF-8"?>' + text[idx:]


def _parse_flashalert_xml(text: str) -> list[dict]:
    """Parse the FlashAlert proprietary XML format into alert dicts."""
    cleaned = _strip_flashalert_dtd(text)
    try:
        root = ET.fromstring(cleaned)
    except ET.ParseError as exc:
        raise ValueError(f"FlashAlert XML parse error: {exc}") from exc

    results = []
    for report in root.iter("emergency_report"):
        orgname  = (report.findtext("orgname") or "").strip()
        detail   = (report.findtext("detail") or "").strip()
        category = ""
        # Walk up to the emergency_category to get the category name
        for cat in root.iter("emergency_category"):
            if report in list(cat):
                category = cat.get("name", "")
                break
        results.append({
            "source":    "flashalert",
            "title":     f"{orgname}: {category}".strip(": ") if orgname else category,
            "summary":   detail[:500],
            "link":      "https://www.flashalertportland.net/",
            "published": report.get("effective_date", ""),
            "severity":  report.get("operating_code", ""),
        })
    return results


class AlertPoller(BasePoller):
    name = "alerts"
    interval = 60

    async def poll(self):
        items: list[dict] = []

        # ── FlashAlert Portland emergency feed ───────────────────────────────
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(_FLASHALERT_EMERGENCY_URL)
                resp.raise_for_status()
            items.extend(_parse_flashalert_xml(resp.text))
        except Exception as exc:
            logger.warning("[alerts] flashalert failed: %s", exc)

        # ── NWS CAP alerts (covers WA/Multnomah/Clackamas) ──────────────────
        try:
            zones = settings.nws_alert_zones
            url = f"https://api.weather.gov/alerts/active?zone={zones}"
            async with httpx.AsyncClient(timeout=15, headers=_NWS_HEADERS) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            for feature in resp.json().get("features", [])[:15]:
                props = feature.get("properties", {})
                items.append({
                    "source":    "nws_cap",
                    "title":     props.get("headline", props.get("event", "")),
                    "summary":   props.get("description", ""),
                    "link":      props.get("@id", ""),
                    "published": props.get("effective", ""),
                    "severity":  props.get("severity", ""),
                    "certainty": props.get("certainty", ""),
                })
        except Exception as exc:
            logger.warning("[alerts] nws_cap failed: %s", exc)

        # ── TVFR Emergency Alerts ─────────────────────────────────────────
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(_TVFR_RSS_URL)
                resp.raise_for_status()
            feed = feedparser.parse(resp.text)
            for entry in feed.entries[:10]:
                items.append({
                    "source":    "tvfr",
                    "title":     entry.get("title", ""),
                    "summary":   entry.get("summary", "") or entry.get("description", ""),
                    "link":      entry.get("link", "https://www.tvfr.com"),
                    "published": entry.get("published", "") or entry.get("updated", ""),
                    "severity":  "Unknown",
                })
        except Exception as exc:
            logger.warning("[alerts] tvfr failed: %s", repr(exc))

        await set_feed("alerts:flash", items)
