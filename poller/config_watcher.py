import asyncio
import logging

import asyncpg

from config_loader import CONFIG_PATH, load_sources_config
from config_sync import sync_sources_to_db

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 5.0


async def watch_config(pool: asyncpg.Pool) -> None:
    """Async task that watches sources.yml for changes and syncs DB on each edit."""
    last_mtime = 0.0

    while True:
        await asyncio.sleep(_POLL_INTERVAL)
        try:
            if not CONFIG_PATH.exists():
                continue
            mtime = CONFIG_PATH.stat().st_mtime
            if mtime == last_mtime:
                continue
            last_mtime = mtime
            config = load_sources_config()
            await sync_sources_to_db(config, pool)
            logger.info("[config_watcher] sources.yml reloaded and synced")
        except Exception as exc:
            logger.warning("[config_watcher] reload error: %s", exc)
