import logging
import xml.etree.ElementTree as ET
import feedparser
import httpx
from config import settings
from security import validate_safe_url
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
        orgname = (report.findtext("orgname") or "").strip()
        detail = (report.findtext("detail") or "").strip()
        category = ""
        for cat in root.iter("emergency_category"):
            if report in list(cat):
                category = cat.get("name", "")
                break
        results.append(
            {
                "source": "flashalert",
                "title": f"{orgname}: {category}".strip(": ") if orgname else category,
                "summary": detail[:500],
                "link": "https://www.flashalertportland.net/",
                "published": report.get("effective_date", ""),
                "severity": report.get("operating_code", ""),
            }
        )
    return results


def _parse_rss_feed(text: str, source_name: str, fallback_url: str) -> list[dict]:
    feed = feedparser.parse(text)
    items = []
    for entry in feed.entries[:10]:
        items.append(
            {
                "source": source_name.lower().replace(" ", "_"),
                "title": entry.get("title", ""),
                "summary": entry.get("summary", "") or entry.get("description", ""),
                "link": entry.get("link", fallback_url),
                "published": entry.get("published", "") or entry.get("updated", ""),
                "severity": "Unknown",
            }
        )
    return items


class AlertPoller(BasePoller):
    name = "alerts"
    interval = 60

    def __init__(self):
        self._zones: str = ""
        self._alert_feeds: list[dict] = []

    async def setup(self):
        from db import get_pool

        # ── NWS alert zones ──────────────────────────────────────────────────
        rows = await get_pool().fetch(
            "SELECT zone_code FROM alert_zone_configs WHERE enabled = TRUE"
        )
        if rows:
            self._zones = ",".join(row["zone_code"] for row in rows)
            logger.info(
                "[alerts] %d NWS zone(s) loaded from DB: %s", len(rows), self._zones
            )
        else:
            # Fall back to env var for deployments that haven't migrated yet.
            self._zones = settings.nws_alert_zones
            if self._zones:
                logger.info(
                    "[alerts] no zones in DB — using NWS_ALERT_ZONES env fallback: %s",
                    self._zones,
                )
            else:
                logger.warning("[alerts] no NWS alert zones configured")

        # ── Alert feeds (FlashAlert, agency RSS, etc.) ───────────────────────
        feed_rows = await get_pool().fetch(
            "SELECT name, url, format FROM alert_feed_configs WHERE enabled = TRUE"
        )
        if feed_rows:
            self._alert_feeds = [dict(r) for r in feed_rows]
            logger.info(
                "[alerts] %d alert feed(s) loaded from DB", len(self._alert_feeds)
            )
        else:
            # Fall back to env vars for deployments that haven't migrated yet.
            fallbacks = []
            if settings.flashalert_enabled and settings.flashalert_url:
                fallbacks.append(
                    {
                        "name": "FlashAlert",
                        "url": settings.flashalert_url,
                        "format": "flashalert_xml",
                    }
                )
            if settings.tvfr_enabled and settings.tvfr_rss_url:
                fallbacks.append(
                    {"name": "TVFR", "url": settings.tvfr_rss_url, "format": "rss"}
                )
            self._alert_feeds = fallbacks
            if fallbacks:
                logger.info(
                    "[alerts] no alert feeds in DB — using env var fallback (%d feed(s))",
                    len(fallbacks),
                )
            else:
                logger.warning("[alerts] no alert feeds configured")

    async def poll(self):
        items: list[dict] = []
        weather_alerts: list[dict] = []

        # ── URL-based alert feeds ────────────────────────────────────────────
        import asyncio
        async def _validate_request_url(request: httpx.Request):
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, validate_safe_url, str(request.url))
            except ValueError as e:
                raise httpx.RequestError(
                    f"SSRF validation failed: {e}", request=request
                )

        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=True,
            event_hooks={"request": [_validate_request_url]},
        ) as client:
            for feed in self._alert_feeds:
                try:
                    resp = await client.get(feed["url"])
                    resp.raise_for_status()
                    if feed["format"] == "flashalert_xml":
                        items.extend(_parse_flashalert_xml(resp.text))
                    else:
                        items.extend(
                            _parse_rss_feed(resp.text, feed["name"], feed["url"])
                        )
                except Exception as exc:
                    logger.warning(
                        "[alerts] feed %r failed: %s: %s",
                        feed["name"],
                        type(exc).__name__,
                        exc or "(no detail)",
                    )

        # ── NWS CAP alerts ───────────────────────────────────────────────────
        if self._zones:
            try:
                url = f"https://api.weather.gov/alerts/active?zone={self._zones}"
                async with httpx.AsyncClient(
                    timeout=15, headers=_NWS_HEADERS
                ) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()

                    seen_headlines = set()
                    for feature in resp.json().get("features", [])[:15]:
                        props = feature.get("properties", {})
                        headline = props.get("headline", props.get("event", ""))

                        if headline in seen_headlines:
                            logger.debug(
                                "[alerts] skipping duplicate NWS alert: %s", headline
                            )
                            continue
                        seen_headlines.add(headline)

                        weather_alerts.append(
                            {
                                "event": props.get("event", ""),
                                "headline": headline,
                                "description": props.get("description", ""),
                                "severity": props.get("severity", ""),
                                "expires": props.get("expires", ""),
                            }
                        )
                        items.append(
                            {
                                "source": "nws_cap",
                                "title": headline,
                                "summary": props.get("description", ""),
                                "link": props.get("@id", ""),
                                "published": props.get("effective", ""),
                                "severity": props.get("severity", ""),
                                "certainty": props.get("certainty", ""),
                            }
                        )
            except Exception as exc:
                logger.warning(
                    "[alerts] nws_cap failed: %s: %s",
                    type(exc).__name__,
                    exc or "(no detail)",
                )

            await set_feed("weather:alerts", weather_alerts)
        await set_feed("alerts:flash", items)
