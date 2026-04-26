import logging

import asyncpg

from config_loader import AlertZonesConfig, NewsFeedEntry, PollerSourceEntry, RadioStreamEntry, SourcesConfig

logger = logging.getLogger(__name__)


async def sync_sources_to_db(config: SourcesConfig, pool: asyncpg.Pool) -> None:
    """Sync sources.yml entries to DB.

    For source='config' entries: full diff — inserts new, removes deleted.
    For source='user' entries: inserts missing only — never auto-deletes,
    since user entries are only removed via the API (which also removes them
    from the YAML). This ensures user-added sources survive a DB wipe.
    """
    async with pool.acquire() as conn:
        rs = await _sync_radio_streams(config.radio_streams, conn)
        nf = await _sync_news_feeds(config.news_feeds, conn)
        ps = await _sync_poller_sources(config.poller_sources, conn)
        az = await _sync_alert_zones(config.alert_zones, conn)

    if any((rs, nf, ps, az)):
        logger.info(
            "[config_sync] radio_streams(%s) news_feeds(%s) poller_sources(%s) alert_zones(%s)",
            rs, nf, ps, az,
        )
    else:
        logger.debug("[config_sync] no changes")


async def _sync_radio_streams(
    entries: list[RadioStreamEntry], conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT url, source FROM radio_streams")
    db_all_urls = {row["url"] for row in existing}
    db_config_urls = {row["url"] for row in existing if row["source"] == "config"}

    yaml_config_urls = {e.url for e in entries if e.source == "config"}
    added = removed = 0

    for entry in entries:
        if entry.url not in db_all_urls:
            await conn.execute(
                """
                INSERT INTO radio_streams (name, url, format, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                """,
                entry.name, entry.url, entry.format, entry.enabled, entry.source,
            )
            added += 1

    to_remove = db_config_urls - yaml_config_urls
    if to_remove:
        await conn.execute(
            "DELETE FROM radio_streams WHERE source = 'config' AND url = ANY($1::text[])",
            list(to_remove),
        )
        removed += len(to_remove)

    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_news_feeds(
    entries: list[NewsFeedEntry], conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT name, url, source FROM news_feeds")
    db_all_keys = {(row["url"] or row["name"]) for row in existing}
    db_config_keys = {(row["url"] or row["name"]) for row in existing if row["source"] == "config"}

    yaml_config_keys = {(e.url or e.name) for e in entries if e.source == "config"}
    added = removed = 0

    for entry in entries:
        key = entry.url or entry.name
        if key not in db_all_keys:
            await conn.execute(
                """
                INSERT INTO news_feeds (name, url, format, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                """,
                entry.name, entry.url, entry.format, entry.enabled, entry.source,
            )
            added += 1

    to_remove = db_config_keys - yaml_config_keys
    for key in to_remove:
        await conn.execute(
            """
            DELETE FROM news_feeds
            WHERE source = 'config' AND (url = $1 OR (url IS NULL AND name = $1))
            """,
            key,
        )
        removed += 1

    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_poller_sources(
    entries: list[PollerSourceEntry], conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT type, url, source FROM poller_sources")
    db_all_keys = {(row["type"], row["url"]) for row in existing}
    db_config_keys = {(row["type"], row["url"]) for row in existing if row["source"] == "config"}

    yaml_config_keys = {(e.type, e.url) for e in entries if e.source == "config"}
    added = removed = 0

    for entry in entries:
        key = (entry.type, entry.url)
        if key not in db_all_keys:
            await conn.execute(
                """
                INSERT INTO poller_sources (type, name, url, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                """,
                entry.type, entry.name, entry.url, entry.enabled, entry.source,
            )
            added += 1

    to_remove = db_config_keys - yaml_config_keys
    for src_type, url in to_remove:
        await conn.execute(
            "DELETE FROM poller_sources WHERE source = 'config' AND type = $1 AND url = $2",
            src_type, url,
        )
        removed += 1

    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_alert_zones(
    alert_zones: AlertZonesConfig, conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT zone_code, source FROM alert_zone_configs")
    db_all_codes = {row["zone_code"] for row in existing}
    db_config_codes = {row["zone_code"] for row in existing if row["source"] == "config"}

    yaml_config_codes = set(alert_zones.nws_zones) if alert_zones.source == "config" else set()
    added = removed = 0

    for code in set(alert_zones.nws_zones) - db_all_codes:
        await conn.execute(
            """
            INSERT INTO alert_zone_configs (zone_code, enabled, source, created_at, updated_at)
            VALUES ($1, TRUE, $2, NOW(), NOW())
            ON CONFLICT (zone_code) DO NOTHING
            """,
            code, alert_zones.source,
        )
        added += 1

    to_remove = db_config_codes - yaml_config_codes
    if to_remove:
        await conn.execute(
            "DELETE FROM alert_zone_configs WHERE source = 'config' AND zone_code = ANY($1::text[])",
            list(to_remove),
        )
        removed += len(to_remove)

    return f"+{added} -{removed}" if (added or removed) else ""
