from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    from db import models  # noqa: F401
    async with engine.begin() as conn:
        # Core schema is managed by db/init/ SQL scripts (run on fresh volume only).
        # Users table (and others) are checked here so existing deployments pick them up automatically.
        try:
            await conn.run_sync(Base.metadata.create_all)
        except IntegrityError as exc:
            # In multi-worker startup, concurrent metadata creation can race on
            # sequence names (e.g. alert_rules_id_seq). Ignore this known race.
            if "pg_class_relname_nsp_index" not in str(exc):
                raise
        # Lightweight compatibility migration for Sprint 2 additions.
        await conn.execute(text("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS geofence_shape VARCHAR(16) NOT NULL DEFAULT 'polygon'"))
        await conn.execute(text("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION"))
        await conn.execute(text("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS center_lon DOUBLE PRECISION"))
        await conn.execute(text("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION"))
        await conn.execute(text("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS dwell_seconds INTEGER NOT NULL DEFAULT 0"))
