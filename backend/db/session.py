from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        # Core schema is managed by db/init/ SQL scripts (run on fresh volume only).
        # Users table is created here so existing deployments pick it up automatically.
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id            SERIAL       PRIMARY KEY,
                username      VARCHAR(64)  UNIQUE NOT NULL,
                password_hash VARCHAR(256) NOT NULL,
                role          VARCHAR(32)  NOT NULL DEFAULT 'admin',
                created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                last_login    TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);
        """))
