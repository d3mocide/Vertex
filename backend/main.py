import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from auth_middleware import AuthMiddleware
from config import settings
from db.session import init_db
from rate_limit import RateLimitMiddleware
from redis_bus import init_redis, close_redis
from routers import entities, observations, events, weather, alerts, news, traffic, health, ws, radio, utilities, summary, auth, geofences, sources, aircraft, admin

logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await init_redis()
    yield
    await close_redis()


app = FastAPI(title="Vertex API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Instrumentator().instrument(app).expose(app)
app.add_middleware(AuthMiddleware)
app.add_middleware(RateLimitMiddleware, calls=60, period=60)

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
app.include_router(ws.router)
