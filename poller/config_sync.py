import logging

import asyncpg

from config_loader import AlertZonesConfig, NewsFeedEntry, PollerSourceEntry, RadioStreamEntry, SourcesConfig

logger = logging.getLogger(__name__)


async def sync_sources_to_db(config: SourcesConfig, pool: asyncpg.Pool) -> None:
    """Sync sources.yml config-source entries to DB.

    Only rows with source='config' are touched — user-added rows are never
    modified or deleted by this function.
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
    existing = await conn.fetch("SELECT url FROM radio_streams WHERE source = 'config'")
    db_urls = {row["url"] for row in existing}
    yaml_urls = {e.url for e in entries}

    for entry in entries:
        if entry.url not in db_urls:
            await conn.execute(
                """
                INSERT INTO radio_streams (name, url, format, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'config', NOW(), NOW())
                """,
                entry.name, entry.url, entry.format, entry.enabled,
            )

    to_remove = db_urls - yaml_urls
    if to_remove:
        await conn.execute(
            "DELETE FROM radio_streams WHERE source = 'config' AND url = ANY($1::text[])",
            list(to_remove),
        )

    added, removed = len(yaml_urls - db_urls), len(to_remove)
    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_news_feeds(
    entries: list[NewsFeedEntry], conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT name, url FROM news_feeds WHERE source = 'config'")
    # Match by url when present, fall back to name for static (url-less) entries.
    db_keys = {(row["url"] or row["name"]) for row in existing}
    yaml_keys = {(e.url or e.name) for e in entries}

    for entry in entries:
        key = entry.url or entry.name
        if key not in db_keys:
            await conn.execute(
                """
                INSERT INTO news_feeds (name, url, format, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'config', NOW(), NOW())
                """,
                entry.name, entry.url, entry.format, entry.enabled,
            )

    to_remove = db_keys - yaml_keys
    if to_remove:
        for key in to_remove:
            await conn.execute(
                """
                DELETE FROM news_feeds
                WHERE source = 'config'
                  AND (url = $1 OR (url IS NULL AND name = $1))
                """,
                key,
            )

    added, removed = len(yaml_keys - db_keys), len(to_remove)
    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_poller_sources(
    entries: list[PollerSourceEntry], conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT type, url FROM poller_sources WHERE source = 'config'")
    db_keys = {(row["type"], row["url"]) for row in existing}
    yaml_keys = {(e.type, e.url) for e in entries}

    for entry in entries:
        key = (entry.type, entry.url)
        if key not in db_keys:
            await conn.execute(
                """
                INSERT INTO poller_sources (type, name, url, enabled, source, created_at, updated_at)
                VALUES ($1, $2, $3, $4, 'config', NOW(), NOW())
                """,
                entry.type, entry.name, entry.url, entry.enabled,
            )

    to_remove = db_keys - yaml_keys
    if to_remove:
        for src_type, url in to_remove:
            await conn.execute(
                "DELETE FROM poller_sources WHERE source = 'config' AND type = $1 AND url = $2",
                src_type, url,
            )

    added, removed = len(yaml_keys - db_keys), len(to_remove)
    return f"+{added} -{removed}" if (added or removed) else ""


async def _sync_alert_zones(
    alert_zones: AlertZonesConfig, conn: asyncpg.Connection
) -> str:
    existing = await conn.fetch("SELECT zone_code FROM alert_zone_configs WHERE source = 'config'")
    db_codes = {row["zone_code"] for row in existing}
    yaml_codes = set(alert_zones.nws_zones)

    for code in yaml_codes - db_codes:
        await conn.execute(
            """
            INSERT INTO alert_zone_configs (zone_code, enabled, source, created_at, updated_at)
            VALUES ($1, TRUE, 'config', NOW(), NOW())
            ON CONFLICT (zone_code) DO NOTHING
            """,
            code,
        )

    to_remove = db_codes - yaml_codes
    if to_remove:
        await conn.execute(
            "DELETE FROM alert_zone_configs WHERE source = 'config' AND zone_code = ANY($1::text[])",
            list(to_remove),
        )

    added, removed = len(yaml_codes - db_codes), len(to_remove)
    return f"+{added} -{removed}" if (added or removed) else ""
