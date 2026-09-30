import asyncio
import logging
import time
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
from pollers.radio_incident_poller import RadioIncidentPoller
from pollers.seismic import SeismicPoller
from pollers.fire import FirePoller
from pollers.firms import FirmsPoller
from pollers.odf_fire_danger import OdfFireDangerPoller
from pollers.aprs import AprsPoller
from pollers.acars import AcarsPoller
from pollers.cot_emitter import CotEmitter
from pollers.cot_receiver import CotReceiver
from pollers.p25_recorder import P25AudioRecorder
from pollers.advisory import AdvisoryPoller
from pollers.anomaly import AnomalyDetectionPoller
from pollers.mqtt_subscriber import MqttSubscriberPoller
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
from region_sync import apply_or_wait
from db import init_db, close_db, get_pool, purge_observations, next_purge_delay, last_purge_ts

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
# Suppress per-request transport logs (they include full URLs and query params).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def _rss_mb() -> float:
    return next((int(l.split()[1]) for l in open("/proc/self/status") if l.startswith("VmRSS")), 0) / 1024


async def _memprofile_loop(minutes: int):
    """Diagnostic only (POLLER_MEMPROFILE_MINUTES > 0): log the top live
    allocation sites every `minutes`, plus traced-vs-RSS so heap
    fragmentation from transient spikes shows up as the gap between them."""
    import tracemalloc

    while True:
        await asyncio.sleep(minutes * 60)
        snap = tracemalloc.take_snapshot().filter_traces([
            tracemalloc.Filter(False, tracemalloc.__file__),
            tracemalloc.Filter(False, "<frozen importlib._bootstrap>"),
        ])
        traced, peak = tracemalloc.get_traced_memory()
        rss_kb = next((int(l.split()[1]) for l in open("/proc/self/status") if l.startswith("VmRSS")), 0)
        logger.info("[memprofile] traced %.0f MB (peak %.0f MB), RSS %.0f MB",
                    traced / 2**20, peak / 2**20, rss_kb / 1024)
        for stat in snap.statistics("filename")[:15]:
            logger.info("[memprofile] %8.1f MB  %7d blocks  %s",
                        stat.size / 2**20, stat.count, stat.traceback[0].filename.replace("/usr/local/lib/python3.12/", ""))
        for stat in snap.statistics("lineno")[:10]:
            frame = stat.traceback[0]
            logger.info("[memprofile] line %8.1f MB  %s:%d", stat.size / 2**20,
                        frame.filename.replace("/usr/local/lib/python3.12/", ""), frame.lineno)
        # How much of RSS is freed-but-retained heap? glibc hands it back on trim.
        import ctypes
        before = _rss_mb()
        ctypes.CDLL("libc.so.6").malloc_trim(0)
        logger.info("[memprofile] malloc_trim: RSS %.0f MB -> %.0f MB", before, _rss_mb())


async def _malloc_trim_loop(interval_s: int = 300):
    """Return freed heap to the OS every few minutes.

    Guards against one-off spikes (a large API payload, a GTFS zip) leaving
    glibc holding hundreds of MB of freed memory. Steady-state native churn
    refills the heap within seconds, so this does not lower the baseline —
    it bounds the damage from spikes. Cheap; a no-op where glibc is absent.
    """
    try:
        import ctypes
        trim = ctypes.CDLL("libc.so.6").malloc_trim
    except (OSError, AttributeError):
        logger.info("malloc_trim unavailable — periodic heap trimming disabled")
        return
    while True:
        await asyncio.sleep(interval_s)
        try:
            trim(0)
        except Exception as exc:
            logger.debug("malloc_trim failed: %s", exc)


async def _purge_loop():
    """Purge old observations daily. Scheduled from when the purge last actually ran (recorded in Redis), so
    restarts do not postpone it; a short settle delay after a start keeps it off the DB while pollers spin up."""
    while True:
        await asyncio.sleep(next_purge_delay(await last_purge_ts(), time.time()))
        try:
            await purge_observations()
        except Exception as exc:
            logger.warning("Observation purge failed: %s", exc)
            await asyncio.sleep(3600)   # retry in an hour rather than hammering a failing DB


async def main():
    if settings.poller_memprofile_minutes > 0:
        import tracemalloc
        tracemalloc.start()
        logger.warning("[memprofile] tracemalloc enabled — diagnostic mode, expect extra memory/CPU")
    await init_db()

    # Heartbeats left by an earlier run: a poller that no longer runs (its
    # source was disabled) would otherwise sit on the admin page as stale forever.
    from bus import get_bus
    from pollers.base import _HEARTBEAT_KEY
    await (await get_bus()).delete(_HEARTBEAT_KEY)

    config = load_sources_config()
    await sync_sources_to_db(config, get_pool())

    # The region (from the environment, or chosen in the setup wizard) must be settled before any poller is built.
    await apply_or_wait(get_pool(), settings, await get_bus())

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
        RadioIncidentPoller(),
        SeismicPoller(),
        FirePoller(),
        FirmsPoller(),
        OdfFireDangerPoller(),
        AprsPoller(),
        CotEmitter(),
        CotReceiver(),
        P25AudioRecorder(),
        AdvisoryPoller(),
        AnomalyDetectionPoller(),
        LightningPoller(),
        StreamGaugePoller(),
        GdacsPoller(),
        NifcPoller(),
        GtfsRtPoller(),
        AmtrakPoller(),
        RailInfrastructurePoller(),
    ]

    # Optional integrations — off unless a source exists (they only logged
    # "not configured" and held a task open otherwise).
    if settings.acars_enabled:
        pollers.append(AcarsPoller())
    if settings.mqtt_enabled:
        pollers.append(MqttSubscriberPoller())

    tasks = [asyncio.create_task(p.run()) for p in pollers]
    if settings.poller_memprofile_minutes > 0:
        tasks.append(asyncio.create_task(_memprofile_loop(settings.poller_memprofile_minutes)))
    tasks.append(asyncio.create_task(_purge_loop()))
    tasks.append(asyncio.create_task(_malloc_trim_loop()))
    tasks.append(asyncio.create_task(watch_config(get_pool())))
    logger.info("Started %d pollers + purge + heap trim + config watcher", len(pollers))
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        logger.info("Gather cancelled")
        pass
    except Exception:
        logger.exception("Gather raised exception")
        raise
    finally:
        logger.info("Main exiting")
        await close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
