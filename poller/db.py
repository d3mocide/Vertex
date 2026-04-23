import json
import logging
import uuid
import asyncpg
from config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def init_db():
    global _pool
    dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=8)
    logger.info("DB pool initialized")


async def close_db():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def write_entity_observation(entity: dict):
    """Upsert entity row and append an observation. Runs geofence check if positioned."""
    if _pool is None:
        return

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
    """Delete observations older than 30 days. Returns the number of rows deleted."""
    if _pool is None:
        return 0
    async with _pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM observations WHERE ts < NOW() - INTERVAL '30 days'"
        )
    deleted = int(result.split()[-1])
    logger.info("[db] purged %d old observations", deleted)
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
