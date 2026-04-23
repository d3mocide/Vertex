import logging
import re
from html import unescape

import feedparser
import httpx

from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

# Local/metro newsroom RSS sources
_NEWS_RSS_FEEDS = [
    ("city_tualatin", "https://www.tualatinoregon.gov/rss/news"),
   # ("kgw_local", "https://rssfeeds.kgw.com/kgw/local"),
    ("koin_local", "https://www.koin.com/feed"),
    ("portland_tribune", "https://www.portlandtribune.com/rss"),
    ("opb_local", "https://www.opb.org/arc/outboundfeeds/rss/?outputType=xml"),
]

# Non-RSS resources from OPML are published as informational news links.
_NEWS_RESOURCES = [
    {
        "source": "publicalerts",
        "title": "PublicAlerts.org",
        "summary": "Opt-in emergency alert system for the region.",
        "link": "https://www.publicalerts.org",
    },
    {
        "source": "or_alert",
        "title": "OR-Alert (Oregon)",
        "summary": "Statewide emergency alerting information.",
        "link": "https://www.oregon.gov/eis/siec/pages/or-alert.aspx",
    },
    {
        "source": "flashalert_feeds",
        "title": "FlashAlert XML Feed Directory",
        "summary": "FlashAlert XML feed reference and guidance.",
        "link": "http://flashalert.net/xml-feeds.html",
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

        for resource in _NEWS_RESOURCES:
            items.append({
                "source": resource["source"],
                "title": resource["title"],
                "summary": resource["summary"],
                "link": resource["link"],
                "published": "",
            })

        for source, url in _NEWS_RSS_FEEDS:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                feed = feedparser.parse(resp.text)
                for entry in feed.entries[:10]:
                    items.append({
                        "source": source,
                        "title": _clean_text(entry.get("title", "")),
                        "summary": _clean_text(entry.get("summary", "") or entry.get("description", "")),
                        "link": entry.get("link", ""),
                        "published": entry.get("published", "") or entry.get("updated", ""),
                    })
            except Exception as exc:
                logger.warning("[news] %s failed: %s", source, exc)

        await set_feed("news:local", items)
