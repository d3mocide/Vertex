import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.session import init_db
from redis_bus import init_redis, close_redis
from routers import entities, observations, events, weather, alerts, traffic, health, ws, radio

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


app = FastAPI(title="Civic Grid API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(entities.router, prefix="/api/v1")
app.include_router(observations.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(weather.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(traffic.router, prefix="/api/v1")
app.include_router(radio.router, prefix="/api/v1")
app.include_router(ws.router)
