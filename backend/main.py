import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from auth_middleware import AuthMiddleware
from config import settings
from db.session import init_db
from rate_limit import RateLimitMiddleware
from redis_bus import init_redis, close_redis
from routers import entities, observations, events, weather, alerts, news, traffic, health, ws, radio, utilities, summary, auth, geofences, sources, aircraft, admin, admin_debug, alertrules, sitrep, layers, entity_tags, annotations, config_regions, mesh, acars, rail
from metrics_collector import run_metrics_collector
from sitrep_scheduler import run_sitrep_scheduler
from webhook_dispatcher import run_webhook_dispatcher

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

# Suppress verbose per-request upstream client logs (e.g., WMS tile fetches).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_redis()
    dispatcher_task = asyncio.create_task(run_webhook_dispatcher())
    metrics_task = asyncio.create_task(run_metrics_collector())
    sitrep_task = asyncio.create_task(run_sitrep_scheduler())
    yield
    for task in (dispatcher_task, metrics_task, sitrep_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logging.getLogger(__name__).error("[shutdown] task cleanup error: %s", exc)
    await close_redis()


app = FastAPI(title="Vertex API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)
app.add_middleware(AuthMiddleware)
app.add_middleware(RateLimitMiddleware, calls=600, period=60)

app.include_router(health.router)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(entities.router, prefix="/api/v1")
app.include_router(observations.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(weather.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(news.router, prefix="/api/v1")
app.include_router(traffic.router, prefix="/api/v1")
app.include_router(utilities.router, prefix="/api/v1")
app.include_router(radio.router, prefix="/api/v1")
app.include_router(summary.router, prefix="/api/v1")
app.include_router(aircraft.router, prefix="/api/v1")
app.include_router(geofences.router, prefix="/api/v1")
app.include_router(sources.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(admin_debug.router, prefix="/api/v1")
app.include_router(alertrules.router, prefix="/api/v1")
app.include_router(sitrep.router, prefix="/api/v1")
app.include_router(layers.router, prefix="/api/v1")
app.include_router(entity_tags.router, prefix="/api/v1")
app.include_router(annotations.router, prefix="/api/v1")
app.include_router(config_regions.router, prefix="/api/v1")
app.include_router(mesh.router, prefix="/api/v1")
app.include_router(acars.router, prefix="/api/v1")
app.include_router(rail.router, prefix="/api/v1")
app.include_router(ws.router)
