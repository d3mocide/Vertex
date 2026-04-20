import logging
import feedparser
import httpx
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)

_FEEDS = [
    ("washco_em",    "https://www.co.washington.or.us/RSS/em.xml"),
    ("tualatin_city","https://www.tualatinoregon.gov/rss.xml"),
    ("flashalert",   "https://www.flashalert.net/rss/portland.xml"),
]


class AlertPoller(BasePoller):
    name = "alerts"
    interval = 60

    async def poll(self):
        items: list[dict] = []
        for source, url in _FEEDS:
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.get(url)
                    resp.raise_for_status()
                feed = feedparser.parse(resp.text)
                for entry in feed.entries[:10]:
                    items.append({
                        "source": source,
                        "title": entry.get("title", ""),
                        "summary": entry.get("summary", ""),
                        "link": entry.get("link", ""),
                        "published": entry.get("published", ""),
                    })
            except Exception as exc:
                logger.warning("[alerts] %s failed: %s", source, exc)
        await set_feed("alerts:flash", items)
