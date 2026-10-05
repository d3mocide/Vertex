import asyncio
import os
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
from pollers.p25 import P25Poller
from pollers.meshcore import MeshCorePoller
from pollers.summary import AISummaryPoller
from pollers.radio_incident_poller import RadioIncidentPoller
from pollers.ems_activity import EmsActivityPoller
from pollers.seismic import SeismicPoller
from pollers.fire import FirePoller
from pollers.firms import FirmsPoller
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
from pollers.nifc_incidents import NifcIncidentsPoller
from pollers.amtrak import AmtrakPoller
from pollers.rail_infrastructure import RailInfrastructurePoller
from bus import close
from config_loader import load_sources_config
from config_sync import sync_sources_to_db
from config_watcher import watch_config
from region_sync import apply_or_wait
from providers import start_providers
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


def _deep_size(obj, seen: set, budget: list) -> int:
    """Approximate retained size of a container: shallow sizes summed through dicts, lists, sets, tuples and
    deques, stopping after `budget[0]` objects (a huge container is then an under-estimate, flagged by the caller)."""
    import sys
    from collections import deque
    stack, total = [obj], 0
    while stack and budget[0] > 0:
        o = stack.pop()
        if id(o) in seen:
            continue
        seen.add(id(o))
        budget[0] -= 1
        total += sys.getsizeof(o)
        if isinstance(o, dict):
            stack.extend(o.keys())
            stack.extend(o.values())
        elif isinstance(o, (list, tuple, set, frozenset, deque)):
            stack.extend(o)
    return total


_CENSUS_MODULES = {"bus", "db", "geocoder", "geo_tags", "street_names", "radio_incidents", "pollers", "enrichment"}


def _census() -> None:
    """Cheap attribution (no tracemalloc): which object types dominate the live heap, and which poller attributes
    and module-level containers are large."""
    import gc
    import sys
    from collections import Counter
    from pollers.base import BasePoller

    objs = gc.get_objects()
    sizes: Counter = Counter()
    counts: Counter = Counter()
    for o in objs:
        t = type(o).__name__
        counts[t] += 1
        sizes[t] += sys.getsizeof(o)
    logger.info("[memprofile] %d live objects; shallow size by type: %s", len(objs),
                ", ".join(f"{t} {sizes[t] / 2**20:.0f}MB/{counts[t]}" for t, _ in sizes.most_common(8)))

    rows, seen = [], set()
    for o in objs:
        if isinstance(o, BasePoller):
            owner = type(o).__name__
        elif isinstance(o, type(sys)) and o.__name__.split(".")[0] in _CENSUS_MODULES:
            owner = o.__name__
        else:
            continue
        for name, val in list(vars(o).items()):
            if isinstance(val, (bytes, bytearray)):
                if len(val) > 2**20:
                    rows.append((len(val), f"{owner}.{name}", type(val).__name__, len(val), False))
            elif isinstance(val, (dict, list, set, tuple)) and len(val) >= 200:
                budget = [200_000]
                rows.append((_deep_size(val, seen, budget), f"{owner}.{name}", type(val).__name__, len(val), budget[0] <= 0))
    for size, where, kind, n, capped in sorted(rows, reverse=True)[:15]:
        logger.info("[memprofile] %8.1f MB%s  %s (%s, %d)", size / 2**20, "+" if capped else " ", where, kind, n)
    logger.info("[memprofile] asyncio tasks: %d", len(asyncio.all_tasks()))


async def _memprofile_loop(minutes: int):
    """Diagnostic only (POLLER_MEMPROFILE_MINUTES > 0): every `minutes`, log which poller attributes hold the
    memory (see _census). With POLLER_MEMPROFILE_TRACE=1 it also logs the top tracemalloc allocation sites; that
    mode roughly doubles memory and can push a small host over the edge, so it is off by default."""
    import tracemalloc

    while True:
        await asyncio.sleep(minutes * 60)
        _census()
        if tracemalloc.is_tracing():
            snap = tracemalloc.take_snapshot().filter_traces([
                tracemalloc.Filter(False, tracemalloc.__file__),
                tracemalloc.Filter(False, "<frozen importlib._bootstrap>"),
            ])
            traced, peak = tracemalloc.get_traced_memory()
            logger.info("[memprofile] traced %.0f MB (peak %.0f MB), RSS %.0f MB", traced / 2**20, peak / 2**20, _rss_mb())
            for stat in snap.statistics("filename")[:15]:
                logger.info("[memprofile] %8.1f MB  %7d blocks  %s",
                            stat.size / 2**20, stat.count, stat.traceback[0].filename.replace("/usr/local/lib/python3.12/", ""))
        # How much of RSS is freed-but-retained heap? glibc hands it back on trim.
        import ctypes
        before = _rss_mb()
        ctypes.CDLL("libc.so.6").malloc_trim(0)
        logger.info("[memprofile] RSS %.0f MB, after malloc_trim %.0f MB", before, _rss_mb())


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
    delay = 45      # first trim soon after start-up: pollers restoring caches leave hundreds of MB of freed heap
    while True:
        await asyncio.sleep(delay)
        delay = interval_s
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


_START_STAGGER_S = 0.25


async def _start_after(delay: float, poller):
    await asyncio.sleep(delay)
    await poller.run()


async def main():
    if settings.poller_memprofile_minutes > 0:
        logger.warning("[memprofile] memory census every %d min — diagnostic mode", settings.poller_memprofile_minutes)
        if os.environ.get("POLLER_MEMPROFILE_TRACE"):
            import tracemalloc
            tracemalloc.start()
            logger.warning("[memprofile] tracemalloc enabled — expect roughly double the memory and extra CPU")
    if os.environ.get("POLLER_LOOP_DEBUG"):
        # Names any callback that holds the event loop for over 0.5 s ("Executing <Task ...> took 6.1 seconds"):
        # a stalled loop is what makes Redis reads exceed their 5 s socket timeout. Diagnostic only; slows the loop.
        loop = asyncio.get_running_loop()
        loop.set_debug(True)
        loop.slow_callback_duration = 0.5
        logging.getLogger("asyncio").setLevel(logging.WARNING)
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
        P25Poller(),
        MeshCorePoller(),
        AISummaryPoller(),
        RadioIncidentPoller(),
        EmsActivityPoller(),
        SeismicPoller(),
        FirePoller(),
        FirmsPoller(),
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
        NifcIncidentsPoller(),
        AmtrakPoller(),
        RailInfrastructurePoller(),
    ]
    pollers.extend(await start_providers(get_pool(), settings, await get_bus()))

    # Optional integrations — off unless a source exists (they only logged
    # "not configured" and held a task open otherwise).
    if settings.acars_enabled:
        pollers.append(AcarsPoller())
    if settings.mqtt_enabled:
        pollers.append(MqttSubscriberPoller())

    # Staggered: 30-odd pollers all starting in the same instant saturate the event loop (and the container's 1 CPU)
    # for ~20 s, long enough for Redis reads to hit their 5 s timeout and caches to fail to restore.
    tasks = [asyncio.create_task(_start_after(i * _START_STAGGER_S, p)) for i, p in enumerate(pollers)]
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
