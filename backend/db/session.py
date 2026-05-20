from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from db import models  # noqa: F401

    # Step 1: create core schema.
    # Use engine.connect() + explicit commit/rollback instead of engine.begin() so
    # that when we *catch* the known concurrent-startup IntegrityError we can call
    # rollback() ourselves before releasing the connection. With engine.begin(),
    # catching the exception inside the block still causes SQLAlchemy to call
    # commit() on __aexit__ — but PostgreSQL has already marked the transaction
    # aborted, so that commit fails and the connection is returned to the pool in
    # a broken state, poisoning subsequent queries.
    async with engine.connect() as conn:
        try:
            await conn.run_sync(Base.metadata.create_all)
            await conn.commit()
        except IntegrityError as exc:
            await conn.rollback()
            # In multi-worker startup, concurrent metadata creation can race on
            # sequence names (e.g. talkgroups_id_seq). This is a known safe race —
            # the other worker already created the table. Ignore it.
            if "pg_class_relname_nsp_index" not in str(exc):
                raise

    # Step 2: lightweight compatibility migrations — each in its own transaction
    # so a failure on one column does not abort the others.
    migrations = [
        "ALTER TABLE geofences ADD COLUMN IF NOT EXISTS geofence_shape VARCHAR(16) NOT NULL DEFAULT 'polygon'",
        "ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION",
        "ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lon DOUBLE PRECISION",
        "ALTER TABLE geofences ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION",
        "ALTER TABLE geofences ADD COLUMN IF NOT EXISTS dwell_seconds INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE annotations ADD COLUMN IF NOT EXISTS tak_uid VARCHAR(128)",
        "CREATE INDEX IF NOT EXISTS ix_annotations_tak_uid ON annotations (tak_uid) WHERE tak_uid IS NOT NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(128)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_api_key_hash ON users (api_key_hash) WHERE api_key_hash IS NOT NULL",
        "ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS cooldown_seconds INTEGER",
        "ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS max_per_hour INTEGER",
        "ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(256)",
        "ALTER TABLE p25_recordings ADD COLUMN IF NOT EXISTS transcription TEXT",
        "ALTER TABLE mesh_messages ADD COLUMN IF NOT EXISTS channel_name VARCHAR(128)",
        """
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
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_acars_frame_dedupe ON acars_messages (station_id, tail, freq, ts)",
                """
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
                """,
    ]
    for migration in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(migration))
        except (IntegrityError, ProgrammingError) as exc:
            # Concurrent startup can still race on relation creation in Postgres
            # even when using IF NOT EXISTS. Ignore only the known safe duplicate
            # relation case for the TAK UID index migration.
            msg = str(exc).lower()
            if (
                "pg_class_relname_nsp_index" in msg
                and any(idx in migration for idx in ("ix_annotations_tak_uid", "ix_users_api_key_hash"))
            ):
                continue
            raise
