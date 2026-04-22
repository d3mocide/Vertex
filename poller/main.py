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
from bus import close
from db import init_db, close_db

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
# Suppress per-request transport logs (they include full URLs and query params).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


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
    ]
    tasks = [asyncio.create_task(p.run()) for p in pollers]
    logger.info("Started %d pollers", len(tasks))
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        pass
    finally:
        await close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
