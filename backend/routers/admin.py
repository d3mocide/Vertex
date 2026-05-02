import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Entity, Observation
from deps import get_db, get_redis_client
from metrics_collector import p95_from_buckets

router = APIRouter(prefix="/admin", tags=["admin"])

_DEFAULT_RETENTION_DAYS = 30
_RETENTION_KEY = "config:retention_days"


class RetentionConfig(BaseModel):
    retention_days: int = Field(ge=1, le=365)


class StorageStats(BaseModel):
    observation_count: int
    entity_count: int
    entity_type_counts: dict[str, int]
    retention_days: int


@router.get("/storage", response_model=StorageStats)
async def get_storage(db: AsyncSession = Depends(get_db)):
    obs_count = await db.scalar(select(func.count(Observation.id))) or 0
    entity_count = await db.scalar(select(func.count(Entity.entity_id))) or 0
    type_rows = await db.execute(
        select(Entity.entity_type, func.count(Entity.entity_id)).group_by(Entity.entity_type)
    )
    type_counts = {row[0]: row[1] for row in type_rows}

    r = get_redis_client()
    raw = await r.get(_RETENTION_KEY)
    retention_days = int(raw) if raw else _DEFAULT_RETENTION_DAYS

    return StorageStats(
        observation_count=obs_count,
        entity_count=entity_count,
        entity_type_counts=type_counts,
        retention_days=retention_days,
    )


@router.post("/retention", response_model=RetentionConfig)
async def set_retention(body: RetentionConfig):
    r = get_redis_client()
    await r.set(_RETENTION_KEY, body.retention_days)
    return body


_METRICS_HISTORY_KEY = "metrics:history"


@router.get("/metrics")
async def get_metrics():
    """Operational metrics with 6-minute sparkline history."""
    r = get_redis_client()
    raw_list = await r.lrange(_METRICS_HISTORY_KEY, 0, -1)

    if not raw_list:
        return {"available": False}

    snaps = [json.loads(s) for s in raw_list]
    latest = snaps[-1]
    oldest = snaps[0]

    interval = latest["ts"] - oldest["ts"] if len(snaps) > 1 else 10.0

    def delta(key: str) -> float:
        return latest.get(key, 0.0) - oldest.get(key, 0.0)

    total_reqs = delta("req_total")
    req_rate = total_reqs / interval if interval > 0 else 0.0
    total_5xx = delta("req_5xx")
    error_pct = (total_5xx / total_reqs * 100) if total_reqs > 0 else 0.0

    cpu_delta = delta("cpu_seconds")
    cpu_pct = (cpu_delta / interval * 100) if interval > 0 else 0.0

    memory_mb = latest.get("memory_bytes", 0.0) / 1_048_576
    p95_ms = p95_from_buckets(latest.get("latency_buckets", []))

    history = []
    for i in range(1, len(snaps)):
        prev = snaps[i - 1]
        curr = snaps[i]
        dt = curr["ts"] - prev["ts"]
        if dt <= 0:
            continue
        d_req = curr.get("req_total", 0.0) - prev.get("req_total", 0.0)
        d_5xx = curr.get("req_5xx", 0.0) - prev.get("req_5xx", 0.0)
        history.append({
            "ts": curr["ts"],
            "req_rate": round(d_req / dt, 3),
            "error_pct": round((d_5xx / d_req * 100) if d_req > 0 else 0.0, 1),
            "memory_mb": round(curr.get("memory_bytes", 0.0) / 1_048_576, 1),
            "p95_ms": round(p95_from_buckets(curr.get("latency_buckets", [])), 1),
        })

    return {
        "available": True,
        "req_rate": round(req_rate, 2),
        "error_pct": round(error_pct, 1),
        "memory_mb": round(memory_mb, 1),
        "cpu_pct": round(cpu_pct, 1),
        "p95_ms": round(p95_ms, 1),
        "history": history,
    }
