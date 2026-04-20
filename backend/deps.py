from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession
from db.session import async_session_factory
from redis_bus import get_redis


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session


def get_redis_client():
    return get_redis()
