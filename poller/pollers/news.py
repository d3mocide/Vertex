import logging
import re
from html import unescape

import feedparser
import httpx

from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# Structured news sources with categorization for frontend bucketing.
_NEWS_SOURCES = [
    # Static Tactical Resources
    {
        "id": "publicalerts",
        "source": "publicalerts",
        "title": "PublicAlerts.org",
        "summary": "Opt-in emergency alert system for the region.",
        "link": "https://www.publicalerts.org",
        "category": "Tactical Resources",
        "type": "static"
    },
    {
        "id": "or_alert",
        "source": "or_alert",
        "title": "OR-Alert (Oregon)",
        "summary": "Statewide emergency alerting information.",
        "link": "https://www.oregon.gov/eis/siec/pages/or-alert.aspx",
        "category": "Tactical Resources",
        "type": "static"
    },
    {
        "id": "flashalert_feeds",
        "source": "flashalert_feeds",
        "title": "FlashAlert XML Feed Directory",
        "summary": "FlashAlert XML feed reference and guidance.",
        "link": "http://flashalert.net/xml-feeds.html",
        "category": "Tactical Resources",
        "type": "static"
    },
    # Local Government
    {
        "id": "city_tualatin",
        "source": "City of Tualatin",
        "url": "https://www.tualatinoregon.gov/rss/news",
        "category": "Local Government",
        "type": "rss"
    },
    # Regional News
    {
        "id": "koin_local",
        "source": "KOIN 6",
        "url": "https://www.koin.com/feed",
        "category": "Regional News",
        "type": "rss"
    },
    {
        "id": "portland_tribune",
        "source": "Portland Tribune",
        "url": "https://www.portlandtribune.com/rss",
        "category": "Regional News",
        "type": "rss"
    },
    {
        "id": "opb_local",
        "source": "OPB News",
        "url": "https://www.opb.org/arc/outboundfeeds/rss/?outputType=xml",
        "category": "Regional News",
        "type": "rss"
    },
]

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _clean_text(value: str) -> str:
    text = unescape(value or "")
    text = _TAG_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text


class NewsPoller(BasePoller):
    name = "news"
    interval = 120

    async def poll(self):
        items: list[dict] = []

        for src in _NEWS_SOURCES:
            if src["type"] == "static":
                items.append({
                    "source": src["source"],
                    "title": src["title"],
                    "summary": src["summary"],
                    "link": src["link"],
                    "published": "",
                    "category": src["category"],
                })
            elif src["type"] == "rss":
                try:
                    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                        resp = await client.get(src["url"])
                        resp.raise_for_status()
                    feed = feedparser.parse(resp.text)
                    for entry in feed.entries[:10]:
                        items.append({
                            "source": src["source"],
                            "title": _clean_text(entry.get("title", "")),
                            "summary": _clean_text(entry.get("summary", "") or entry.get("description", "")),
                            "link": entry.get("link", ""),
                            "published": entry.get("published", "") or entry.get("updated", "") or entry.get("pubDate", "") or entry.get("date", "") or entry.get("created", ""),
                            "category": src["category"],
                        })
                except Exception as exc:
                    logger.warning("[news] %s failed: %s", src["id"], exc)

        await set_feed("news:local", items)
