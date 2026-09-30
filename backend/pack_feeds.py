"""Reconcile pack-owned feed rows while preserving operator-managed sources."""
from sqlalchemy import select

from db.models import AlertFeedConfig, NewsFeed


async def sync_pack_feeds(db, config: dict) -> None:
    for section, model in (("news_feeds", NewsFeed), ("alert_feeds", AlertFeedConfig)):
        entries = config.get(section) or []
        desired = {e["url"]: e for e in entries if e.get("source") == "pack"}
        result = await db.execute(select(model))
        rows = result.scalars().all()
        existing = {row.url for row in rows}
        for row in rows:
            if row.source != "pack":
                continue
            entry = desired.get(row.url)
            if entry is None:
                await db.delete(row)
            else:
                row.name = entry["name"]
                row.format = entry.get("format", "rss")
                row.enabled = entry.get("enabled", True)
        for url, entry in desired.items():
            if url not in existing:
                db.add(model(name=entry["name"], url=url, format=entry.get("format", "rss"),
                             enabled=entry.get("enabled", True), source="pack"))
