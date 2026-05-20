import json
import logging
import uuid
import asyncpg
import time
from config import settings
from sanitize import sanitize_payload, sanitize_text

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None

# Throttle observation INSERT rows — one row per entity per N seconds is sufficient
# for trail history; writing every BEAST frame floods the DB unnecessarily.
_OBS_MIN_INTERVAL = 30.0
_last_obs_ts: dict[str, float] = {}


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
        # Widen entity_id from VARCHAR(64) → VARCHAR(255) to accommodate long IDs
        # such as MeshCore node hashes ('mesh_node:' + 64-char SHA256 = 74 chars).
        # ALTER TYPE on a VARCHAR PK cascades to FK columns in PostgreSQL >= 10.
        await conn.execute("ALTER TABLE entities             ALTER COLUMN entity_id TYPE VARCHAR(255)")
        await conn.execute("ALTER TABLE observations         ALTER COLUMN entity_id TYPE VARCHAR(255)")
        await conn.execute("ALTER TABLE events               ALTER COLUMN entity_id TYPE VARCHAR(255)")
        await conn.execute("ALTER TABLE entity_mission_tags  ALTER COLUMN entity_id TYPE VARCHAR(255)")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS acars_messages (
                id          BIGSERIAL    PRIMARY KEY,
                station_id  TEXT,
                tail        TEXT,
                flight      TEXT,
                freq        TEXT,
                label       TEXT,
                msg_num     TEXT,
                msg_text    TEXT,
                error       INTEGER      NOT NULL DEFAULT 0,
                mode        TEXT,
                ts          TIMESTAMPTZ  NOT NULL,
                received_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_acars_frame UNIQUE (station_id, tail, freq, ts)
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_acars_tail ON acars_messages (tail, ts DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_acars_flight ON acars_messages (flight, ts DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_acars_ts ON acars_messages (ts DESC)")
        await conn.execute("""
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY station_id, tail, freq, ts
                           ORDER BY id
                       ) AS row_num
                FROM acars_messages
            )
            DELETE FROM acars_messages AS messages
            USING ranked
            WHERE messages.id = ranked.id
              AND ranked.row_num > 1
        """)
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_acars_frame_dedupe ON acars_messages (station_id, tail, freq, ts)"
        )
        await conn.execute("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_class
                    WHERE relname = 'uq_acars_frame'
                      AND relkind = 'i'
                ) AND NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_acars_frame'
                      AND conrelid = 'acars_messages'::regclass
                ) THEN
                    DROP INDEX uq_acars_frame;
                END IF;

                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_acars_frame'
                      AND conrelid = 'acars_messages'::regclass
                ) THEN
                    ALTER TABLE acars_messages
                        ADD CONSTRAINT uq_acars_frame
                        UNIQUE USING INDEX ix_acars_frame_dedupe;
                END IF;
            END $$
        """)
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

        # Rate-limit observation inserts per entity to avoid write storms from
        # high-frequency sources (BEAST streams entities at 1-2 Hz per aircraft).
        entity_id_key = entity["entity_id"]
        now_ts = time.time()
        if now_ts - _last_obs_ts.get(entity_id_key, 0.0) < _OBS_MIN_INTERVAL:
            if lat is not None and lon is not None:
                await check_geofences(entity, conn)
            return
        _last_obs_ts[entity_id_key] = now_ts

        await conn.execute(
            """
            INSERT INTO observations
                (entity_id, ts, lat, lon, altitude, heading, speed, vertical_rate, signal_quality, status, geom)
            VALUES ($1, NOW(), $2::float, $3::float, $4::float, $5::float, $6::float, $7::float, $8::float, $9::text,
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
            entity.get("signal_quality"),
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
        acars_result = await conn.execute(
            "DELETE FROM acars_messages WHERE ts < NOW() - ($1 * INTERVAL '1 day')",
            int(retention_days),
        )
    deleted = int(result.split()[-1])
    acars_deleted = int(acars_result.split()[-1])
    logger.info(
        "[db] purged %d old observations, %d old ACARS messages (retention: %d days)",
        deleted, acars_deleted, retention_days,
    )
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


async def write_acars_message(msg: dict) -> bool:
    """Insert one ACARS message; returns True if it was new (not a duplicate)."""
    if _pool is None:
        return False
    try:
        result = await _pool.fetchval(
            """
            INSERT INTO acars_messages
                (station_id, tail, flight, freq, label, msg_num, msg_text, error, mode, ts)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10))
            ON CONFLICT (station_id, tail, freq, ts) DO NOTHING
            RETURNING id
            """,
            sanitize_text(msg.get("station_id") or ""),
            sanitize_text(msg.get("tail") or ""),
            sanitize_text(msg.get("flight") or ""),
            sanitize_text(msg.get("freq") or ""),
            sanitize_text(msg.get("label") or ""),
            sanitize_text(msg.get("msg_num") or ""),
            sanitize_text(msg.get("msg_text") or ""),
            int(msg.get("error") or 0),
            sanitize_text(msg.get("mode") or ""),
            float(msg.get("timestamp") or 0),
        )
        return result is not None
    except Exception as exc:
        logger.warning("[acars] DB write failed: %s", exc)
        return False
