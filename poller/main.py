import asyncio
import logging
from config import settings
from pollers.adsb import AdsbPoller
from pollers.ais import AisPoller
from pollers.weather import WeatherPoller
from pollers.alerts import AlertPoller
from pollers.news import NewsPoller
from pollers.traffic import TrafficPoller
from pollers.utilities import UtilityPoller
from pollers.p25 import P25Poller
from pollers.meshcore import MeshCorePoller
from pollers.summary import AISummaryPoller
from bus import close
from db import init_db, close_db, purge_observations

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
# Suppress per-request transport logs (they include full URLs and query params).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


async def _purge_loop():
    """Run the observation purge once per day, with an initial 1-hour delay so it
    doesn't hammer the DB immediately after a restart."""
    await asyncio.sleep(3600)
    while True:
        try:
            await purge_observations()
        except Exception as exc:
            logger.warning("Observation purge failed: %s", exc)
        await asyncio.sleep(86400)


async def main():
    await init_db()
    pollers = [
        AdsbPoller(),
        AisPoller(),
        WeatherPoller(),
        AlertPoller(),
        NewsPoller(),
        TrafficPoller(),
        UtilityPoller(),
        P25Poller(),
        MeshCorePoller(),
        AISummaryPoller(),
    ]
    tasks = [asyncio.create_task(p.run()) for p in pollers]
    tasks.append(asyncio.create_task(_purge_loop()))
    logger.info("Started %d pollers + purge task", len(tasks) - 1)
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        await close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
