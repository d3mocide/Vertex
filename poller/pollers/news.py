import logging
import re
from html import unescape

import feedparser
import httpx

from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# Static tactical resource links — these are UI reference entries, not polled.
# They live here rather than in sources.yml because they carry title/summary/link
# metadata that the current news_feeds schema doesn't model.
_STATIC_SOURCES = [
    {
        "source": "publicalerts",
        "title": "PublicAlerts.org",
        "summary": "Opt-in emergency alert system for the region.",
        "link": "https://www.publicalerts.org",
        "category": "Tactical Resources",
    },
    {
        "source": "or_alert",
        "title": "OR-Alert (Oregon)",
        "summary": "Statewide emergency alerting information.",
        "link": "https://www.oregon.gov/eis/siec/pages/or-alert.aspx",
        "category": "Tactical Resources",
    },
    {
        "source": "flashalert_feeds",
        "title": "FlashAlert XML Feed Directory",
        "summary": "FlashAlert XML feed reference and guidance.",
        "link": "http://flashalert.net/xml-feeds.html",
        "category": "Tactical Resources",
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

    def __init__(self):
        self._rss_sources: list[dict] = []

    async def setup(self):
        from db import get_pool
        rows = await get_pool().fetch(
            "SELECT name, url FROM news_feeds WHERE format = 'rss' AND enabled = TRUE"
        )
        self._rss_sources = [{"name": row["name"], "url": row["url"]} for row in rows]
        logger.info("[news] %d RSS source(s) loaded from DB", len(self._rss_sources))

    async def poll(self):
        items: list[dict] = list({
            "source": s["source"],
            "title": s["title"],
            "summary": s["summary"],
            "link": s["link"],
            "published": "",
            "category": s["category"],
        } for s in _STATIC_SOURCES)

        for src in self._rss_sources:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    resp = await client.get(src["url"])
                    resp.raise_for_status()
                feed = feedparser.parse(resp.text)
                for entry in feed.entries[:10]:
                    items.append({
                        "source": src["name"],
                        "title": _clean_text(entry.get("title", "")),
                        "summary": _clean_text(entry.get("summary", "") or entry.get("description", "")),
                        "link": entry.get("link", ""),
                        "published": (
                            entry.get("published") or entry.get("updated")
                            or entry.get("pubDate") or entry.get("date")
                            or entry.get("created") or ""
                        ),
                        "category": "Regional News",
                    })
            except Exception as exc:
                logger.warning("[news] %s failed: %s", src["name"], exc)

        await set_feed("news:local", items)
