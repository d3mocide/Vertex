import logging
import xml.etree.ElementTree as ET
import feedparser
import httpx
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

_NWS_HEADERS = {"User-Agent": "Vertex/0.1 (vertex; contact@localhost)"}


def _strip_flashalert_dtd(text: str) -> str:
    idx = text.find("<flashnews")
    if idx == -1:
        raise ValueError("No <flashnews> root element found in FlashAlert XML")
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

    def __init__(self):
        self._zones: str = ""

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT zone_code FROM alert_zone_configs WHERE enabled = TRUE"
        )
        if rows:
            self._zones = ",".join(row["zone_code"] for row in rows)
            logger.info("[alerts] %d NWS zone(s) loaded from DB: %s", len(rows), self._zones)
        else:
            # Fall back to env var for deployments that haven't migrated yet
            self._zones = settings.nws_alert_zones
            if self._zones:
                logger.info("[alerts] no zones in DB — using NWS_ALERT_ZONES env fallback: %s", self._zones)
            else:
                logger.warning("[alerts] no NWS alert zones configured")

    async def poll(self):
        items: list[dict] = []

        # ── FlashAlert emergency feed ────────────────────────────────────────
        if settings.flashalert_enabled:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    resp = await client.get(settings.flashalert_url)
                    resp.raise_for_status()
                items.extend(_parse_flashalert_xml(resp.text))
            except Exception as exc:
                logger.warning("[alerts] flashalert failed: %s", exc)

        # ── NWS CAP alerts ───────────────────────────────────────────────────
        if self._zones:
            try:
                url = f"https://api.weather.gov/alerts/active?zone={self._zones}"
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

        # ── TVFR / regional agency emergency alert RSS ────────────────────
        if settings.tvfr_enabled:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    resp = await client.get(settings.tvfr_rss_url)
                    resp.raise_for_status()
                feed = feedparser.parse(resp.text)
                for entry in feed.entries[:10]:
                    items.append({
                        "source":    "tvfr",
                        "title":     entry.get("title", ""),
                        "summary":   entry.get("summary", "") or entry.get("description", ""),
                        "link":      entry.get("link", settings.tvfr_rss_url),
                        "published": entry.get("published", "") or entry.get("updated", ""),
                        "severity":  "Unknown",
                    })
            except Exception as exc:
                logger.warning("[alerts] tvfr failed: %s", repr(exc))

        await set_feed("alerts:flash", items)
