from sqlalchemy import text
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
        await conn.run_sync(Base.metadata.create_all)
