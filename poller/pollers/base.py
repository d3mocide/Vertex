import asyncio
import json
import logging
import time
from abc import ABC, abstractmethod
from sanitize import sanitize_payload

logger = logging.getLogger(__name__)

_HEARTBEAT_KEY = "metrics:poller_heartbeats"
# Longest delay between polls of a source that keeps failing.
_MAX_BACKOFF_S = 900


class BasePoller(ABC):
    name: str = "base"
    interval: int = 60
    _error_count: int = 0  # class-level default; run() creates instance var on first error

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
            payload = json.dumps(sanitize_payload({
                "ts": time.time(),
                "status": status,
                "last_error": last_error,
                "interval": self.interval,
                "error_count": self._error_count,
            }))
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
                    if self._error_count:
                        logger.info("[%s] recovered after %d failed poll(s)", self.name, self._error_count)
                    self._error_count = 0
                    await self._heartbeat("ok")
                except Exception as exc:
                    self._error_count += 1
                    # First failure and every 10th: a dead source used to log an
                    # ERROR on every cycle indefinitely.
                    if self._error_count == 1 or self._error_count % 10 == 0:
                        logger.error("[%s] poll error (%d consecutive): %s", self.name, self._error_count, exc)
                    await self._heartbeat("error", str(exc)[:256])
                await asyncio.sleep(self._next_delay())
        finally:
            await self.close()

    def _next_delay(self) -> float:
        """Normal interval; after consecutive failures, back off exponentially
        (up to 15 min, or the interval if that is longer) to stop hammering a
        dead source."""
        if not self._error_count:
            return self.interval
        return min(self.interval * 2 ** min(self._error_count - 1, 6), max(self.interval, _MAX_BACKOFF_S))

    async def close(self):
        """Called when the polling loop is shutting down. Override to perform cleanup tasks."""

