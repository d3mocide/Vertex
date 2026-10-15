"""Radio service: live P25 audio relay and call recorder, in a process of its own.

This used to be one of ~30 pollers sharing the poller's single event loop. Whenever another poller held that
loop (feed parsing, geocoding, a burst of ADS-B), the OP25 audio websocket went unread and the audio reached the
browser seconds late and in bursts, heard as stutter and cut-off calls. Measured against the OP25 host: frames
arrived at the VM on time but left the poller up to 17 s late. Here the audio relay has the loop to itself.

Runs from the poller image (docker-compose `radio` service). Sources talk to the rest of Vertex only through
Redis (call events in, live audio out) and Postgres (recording rows), so another radio feed can be added to
`radio_sources()` without touching the poller.
"""
import asyncio
import logging

from bus import close
from config import settings
from db import open_pool, close_db
from pollers.p25_recorder import P25AudioRecorder
from pollers.tocsin import TocsinPoller

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def radio_sources() -> list:
    return [P25AudioRecorder(), TocsinPoller()]


async def main():
    await open_pool()
    sources = radio_sources()
    logger.info("Radio service started: %s", ", ".join(s.name for s in sources))
    try:
        await asyncio.gather(*(s.run() for s in sources))
        # A source that has nothing to do (recording disabled) returns at once; stay up instead of letting
        # the container restart in a loop.
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        pass
    finally:
        logger.info("Radio service exiting")
        await close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
