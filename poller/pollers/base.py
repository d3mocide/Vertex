import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from sanitize import sanitize_payload

logger = logging.getLogger(__name__)

_HEARTBEAT_KEY = "metrics:poller_heartbeats"


class BasePoller(ABC):
    name: str = "base"
    interval: int = 60

    @abstractmethod
    async def poll(self):
        ...

    async def setup(self):
        """Called once before the polling loop. Override to perform startup tasks."""

    async def _heartbeat(self, status: str = "ok", last_error: str | None = None) -> None:
        """Write a heartbeat entry to Redis so the admin dashboard can show poller health."""
        try:
            from bus import get_bus
            r = await get_bus()
            payload = json.dumps(sanitize_payload({"ts": time.time(), "status": status, "last_error": last_error, "interval": self.interval}))
            await r.hset(_HEARTBEAT_KEY, self.name, payload)
        except Exception:
            pass  # heartbeat is best-effort; never block the poll loop

    async def run(self):
        logger.info("[%s] started (interval=%ds)", self.name, self.interval)
        await self.setup()
        try:
            while True:
                try:
                    await self.poll()
                    await self._heartbeat("ok")
                except Exception as exc:
                    logger.error("[%s] poll error: %s", self.name, exc)
                    await self._heartbeat("error", str(exc)[:256])
                await asyncio.sleep(self.interval)
        finally:
            await self.close()

    async def close(self):
        """Called when the polling loop is shutting down. Override to perform cleanup tasks."""

