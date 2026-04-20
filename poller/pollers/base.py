import asyncio
import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class BasePoller(ABC):
    name: str = "base"
    interval: int = 60

    @abstractmethod
    async def poll(self):
        ...

    async def run(self):
        logger.info("[%s] started (interval=%ds)", self.name, self.interval)
        while True:
            try:
                await self.poll()
            except Exception as exc:
                logger.error("[%s] poll error: %s", self.name, exc)
            await asyncio.sleep(self.interval)
