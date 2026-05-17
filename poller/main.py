import asyncio
import logging
import warnings
from config import settings

# Suppress Pydantic serialization warnings from LiteLLM/Pydantic V2 mismatch
warnings.filterwarnings("ignore", category=UserWarning, message="Pydantic serializer warnings")
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
from pollers.seismic import SeismicPoller
from pollers.fire import FirePoller
from pollers.aprs import AprsPoller
from pollers.acars import AcarsPoller
from pollers.cot_emitter import CotEmitter
from pollers.cot_receiver import CotReceiver
from pollers.p25_recorder import P25AudioRecorder
from pollers.anomaly import AnomalyDetectionPoller
from pollers.tinygs import TinyGSPoller
from pollers.lightning import LightningPoller
from pollers.streamgauge import StreamGaugePoller
from pollers.gdacs import GdacsPoller
from pollers.nifc import NifcPoller
from pollers.gtfs_rt import GtfsRtPoller
from pollers.amtrak import AmtrakPoller
from pollers.rail_infrastructure import RailInfrastructurePoller
from bus import close
from config_loader import load_sources_config
from config_sync import sync_sources_to_db
from config_watcher import watch_config
from db import init_db, close_db, get_pool, purge_observations

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

    config = load_sources_config()
    await sync_sources_to_db(config, get_pool())

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
        SeismicPoller(),
        FirePoller(),
        AprsPoller(),
        CotEmitter(),
        CotReceiver(),
        P25AudioRecorder(),
        AnomalyDetectionPoller(),
        LightningPoller(),
        StreamGaugePoller(),
        GdacsPoller(),
        NifcPoller(),
        AcarsPoller(),
        GtfsRtPoller(),
        AmtrakPoller(),
        RailInfrastructurePoller(),
    ]

    if settings.tinygs_enabled:
        pollers.append(TinyGSPoller())
    else:
        logger.info("[tinygs] integration sunset by default (set TINYGS_ENABLED=true to re-enable)")

    tasks = [asyncio.create_task(p.run()) for p in pollers]
    tasks.append(asyncio.create_task(_purge_loop()))
    tasks.append(asyncio.create_task(watch_config(get_pool())))
    logger.info("Started %d pollers + purge + config watcher", len(tasks) - 2)
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("Gather cancelled")
        pass
    except Exception as exc:
        logger.exception("Gather raised exception")
        raise
    finally:
        logger.info("Main exiting")
        await close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
