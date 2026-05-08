import json
import logging
import uuid
import asyncpg
from config import settings
from sanitize import sanitize_payload, sanitize_text

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call init_db() first")
    return _pool


async def init_db():
    global _pool
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=8)
    # TODO: migrate to Alembic for schema evolution tracking
    async with _pool.acquire() as conn:
        await conn.execute("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS geofence_shape VARCHAR(16) NOT NULL DEFAULT 'polygon'")
        await conn.execute("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION")
        await conn.execute("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lon DOUBLE PRECISION")
        await conn.execute("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION")
        await conn.execute("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS dwell_seconds INTEGER NOT NULL DEFAULT 0")
        await conn.execute("ALTER TABLE annotations ADD COLUMN IF NOT EXISTS tak_uid VARCHAR(128)")
    logger.info("DB pool initialized")


async def close_db():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def write_entity_observation(entity: dict, record_observation: bool = True):
    """Upsert entity row and append an observation. Runs geofence check if positioned."""
    if _pool is None:
        return
    entity = sanitize_payload(entity)

    from geofence import check_geofences  # lazy — breaks bus→db→geofence→bus cycle

    lat = entity.get("lat")
    lon = entity.get("lon")

    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO entities
                (entity_id, entity_type, source, display_name, identity, tags, first_seen, last_seen)
            VALUES ($1::text, $2::text, $3::text, $4::text, $5::jsonb, $6::jsonb, NOW(), NOW())
            ON CONFLICT (entity_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                identity     = EXCLUDED.identity,
                tags         = EXCLUDED.tags,
                last_seen    = NOW()
            """,
            entity["entity_id"],
            entity["entity_type"],
            entity["source"],
            entity.get("display_name"),
            json.dumps(entity.get("identity") or {}),
            json.dumps(entity.get("tags") or []),
        )

        mode = (settings.adsb_history_mode or "record").strip().lower()
        if mode != "record" or not record_observation:
            if lat is not None and lon is not None:
                await check_geofences(entity, conn)
            return

        await conn.execute(
            """
            INSERT INTO observations
                (entity_id, ts, lat, lon, altitude, heading, speed, vertical_rate, status, geom)
            VALUES ($1, NOW(), $2::float, $3::float, $4::float, $5::float, $6::float, $7::float, $8::text,
                CASE WHEN $2::float IS NOT NULL AND $3::float IS NOT NULL
                     THEN ST_SetSRID(ST_MakePoint($3::float, $2::float), 4326)
                     ELSE NULL END)
            """,
            entity["entity_id"],
            lat,
            lon,
            entity.get("altitude"),
            entity.get("heading"),
            entity.get("speed"),
            entity.get("vertical_rate"),
            entity.get("status"),
        )

        if lat is not None and lon is not None:
            await check_geofences(entity, conn)


async def purge_observations() -> int:
    """Delete observations older than the configured retention window.

    Retention days is read from Redis key ``config:retention_days`` (set by the
    admin API). Falls back to 30 days when the key is absent.
    """
    if _pool is None:
        return 0

    retention_days = 30
    try:
        from bus import get_bus
        r = await get_bus()
        raw = await r.get("config:retention_days")
        if raw:
            retention_days = max(1, min(int(raw), 3650))
    except Exception as exc:
        logger.warning("[db] could not read retention config from Redis: %s", exc)

    async with _pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM observations WHERE ts < NOW() - ($1 * INTERVAL '1 day')",
            int(retention_days),
        )
    deleted = int(result.split()[-1])
    logger.info("[db] purged %d old observations (retention: %d days)", deleted, retention_days)
    return deleted


async def write_event(
    event_type: str,
    entity_id: str | None,
    severity: str,
    summary: str,
    details: dict,
) -> str:
    """Persist an event row to Postgres. Returns the generated event_id."""
    if _pool is None:
        return ""
    event_type = sanitize_text(event_type) or ""
    entity_id = sanitize_text(entity_id)
    severity = sanitize_text(severity) or ""
    summary = sanitize_text(summary) or ""
    details = sanitize_payload(details)
    event_id = str(uuid.uuid4())
    async with _pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO events (event_id, event_type, entity_id, ts, severity, summary, details)
            VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
            """,
            event_id,
            event_type,
            entity_id,
            severity,
            summary,
            json.dumps(details),
        )
    return event_id
