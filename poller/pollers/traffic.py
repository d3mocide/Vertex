import logging
import xml.etree.ElementTree as ET
import httpx
from config import settings
from bus import set_feed
from .base import BasePoller

logger = logging.getLogger(__name__)


class TrafficPoller(BasePoller):
    name = "traffic"
    interval = 30

    async def poll(self):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(settings.odot_incidents_url)
                resp.raise_for_status()
            await set_feed("traffic:incidents", _parse_rss(resp.text))
        except Exception as exc:
            logger.warning("[traffic] incidents fetch failed: %s", exc)


def _parse_rss(xml_text: str) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
        for item in root.findall(".//item"):
            items.append({
                "title":       item.findtext("title", ""),
                "description": item.findtext("description", ""),
                "link":        item.findtext("link", ""),
                "pubDate":     item.findtext("pubDate", ""),
            })
    except ET.ParseError as exc:
        logger.warning("[traffic] XML parse error: %s", exc)
    return items
