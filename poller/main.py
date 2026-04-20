import asyncio
import logging
from config import settings
from pollers.adsb import AdsbPoller
from pollers.ais import AisPoller
from pollers.weather import WeatherPoller
from pollers.alerts import AlertPoller
from pollers.traffic import TrafficPoller
from pollers.p25 import P25Poller
from pollers.meshcore import MeshCorePoller
from bus import close

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def main():
    pollers = [
        AdsbPoller(),
        AisPoller(),
        WeatherPoller(),
        AlertPoller(),
        TrafficPoller(),
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


if __name__ == "__main__":
    asyncio.run(main())
