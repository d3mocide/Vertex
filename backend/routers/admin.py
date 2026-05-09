import json
import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Entity, Observation, Event
from deps import get_db, get_redis_client
from metrics_collector import p95_from_buckets

router = APIRouter(prefix="/admin", tags=["admin"])

_DEFAULT_RETENTION_DAYS = 30
_RETENTION_KEY = "config:retention_days"
_HEARTBEAT_KEY = "metrics:poller_heartbeats"
_STALE_THRESHOLD_S = 120  # poller is STALE if last heartbeat > 2 min ago


class RetentionConfig(BaseModel):
    retention_days: int = Field(ge=1, le=365)


class StorageStats(BaseModel):
    observation_count: int
    entity_count: int
    entity_type_counts: dict[str, int]
    retention_days: int
    table_size_bytes: int
    obs_per_day_7d: float
    event_count: int
    event_type_counts: dict[str, int]


@router.get("/storage", response_model=StorageStats)
async def get_storage(db: AsyncSession = Depends(get_db)):
    obs_count = await db.scalar(select(func.count(Observation.id))) or 0
    entity_count = await db.scalar(select(func.count(Entity.entity_id))) or 0
    type_rows = await db.execute(
        select(Entity.entity_type, func.count(Entity.entity_id)).group_by(Entity.entity_type)
    )
    type_counts = {row[0]: row[1] for row in type_rows}

    # Table size
    size_row = await db.execute(
        text("SELECT pg_total_relation_size('observations')")
    )
    table_size_bytes: int = size_row.scalar() or 0

    # Average observations per day over last 7 days
    growth_row = await db.execute(
        text("""
            SELECT COUNT(*) / 7.0
            FROM observations
            WHERE ts > now() - interval '7 days'
        """)
    )
    obs_per_day_7d: float = float(growth_row.scalar() or 0)

    # Event stats
    event_count = await db.scalar(select(func.count(Event.event_id))) or 0
    event_type_rows = await db.execute(
        select(Event.event_type, func.count(Event.event_id)).group_by(Event.event_type)
    )
    event_type_counts = {row[0]: row[1] for row in event_type_rows}

    r = get_redis_client()
    raw = await r.get(_RETENTION_KEY)
    retention_days = int(raw) if raw else _DEFAULT_RETENTION_DAYS

    return StorageStats(
        observation_count=obs_count,
        entity_count=entity_count,
        entity_type_counts=type_counts,
        retention_days=retention_days,
        table_size_bytes=table_size_bytes,
        obs_per_day_7d=round(obs_per_day_7d, 1),
        event_count=event_count,
        event_type_counts=event_type_counts,
    )


@router.post("/retention", response_model=RetentionConfig)
async def set_retention(body: RetentionConfig):
    r = get_redis_client()
    await r.set(_RETENTION_KEY, body.retention_days)
    return body


_METRICS_HISTORY_KEY = "metrics:history"


@router.get("/metrics")
async def get_metrics(db: AsyncSession = Depends(get_db)):
    """Operational metrics with 60-minute sparkline history."""
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
    ws_clients = latest.get("ws_clients", 0)

    # DB ping
    db_ping_ms: float = 0.0
    try:
        t0 = time.perf_counter()
        await db.execute(text("SELECT 1"))
        db_ping_ms = round((time.perf_counter() - t0) * 1000, 1)
    except Exception:
        db_ping_ms = -1.0

    # Redis ping
    redis_ping_ms: float = 0.0
    try:
        t0 = time.perf_counter()
        await r.ping()
        redis_ping_ms = round((time.perf_counter() - t0) * 1000, 1)
    except Exception:
        redis_ping_ms = -1.0

    history = []
    for i in range(1, len(snaps)):
        prev = snaps[i - 1]
        curr = snaps[i]
        dt = curr["ts"] - prev["ts"]
        if dt <= 0:
            continue
        d_req = curr.get("req_total", 0.0) - prev.get("req_total", 0.0)
        d_5xx = curr.get("req_5xx", 0.0) - prev.get("req_5xx", 0.0)
        d_cpu = curr.get("cpu_seconds", 0.0) - prev.get("cpu_seconds", 0.0)
        history.append({
            "ts": curr["ts"],
            "req_rate": round(d_req / dt, 3),
            "error_pct": round((d_5xx / d_req * 100) if d_req > 0 else 0.0, 1),
            "memory_mb": round(curr.get("memory_bytes", 0.0) / 1_048_576, 1),
            "p95_ms": round(p95_from_buckets(curr.get("latency_buckets", [])), 1),
            "cpu_pct": round((d_cpu / dt * 100) if dt > 0 else 0.0, 1),
            "ws_clients": curr.get("ws_clients", 0),
        })

    return {
        "available": True,
        "req_rate": round(req_rate, 2),
        "error_pct": round(error_pct, 1),
        "memory_mb": round(memory_mb, 1),
        "cpu_pct": round(cpu_pct, 1),
        "p95_ms": round(p95_ms, 1),
        "ws_clients": ws_clients,
        "db_ping_ms": db_ping_ms,
        "redis_ping_ms": redis_ping_ms,
        "history": history,
    }


@router.get("/pollers")
async def get_pollers():
    """Poller heartbeat health grid."""
    r = get_redis_client()
    raw_map: dict[str, str] = await r.hgetall(_HEARTBEAT_KEY)
    now = time.time()

    results = []
    for name, raw in raw_map.items():
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
        ts = data.get("ts", 0.0)
        staleness_s = now - ts if ts else 9999.0
        status = data.get("status", "unknown")
        interval = data.get("interval", 60)
        
        # Stale if missed interval by more than 60 seconds (with minimum 120s total)
        dynamic_threshold = max(_STALE_THRESHOLD_S, interval + 60)
        
        if staleness_s > dynamic_threshold:
            display_status = "stale"
        elif status == "error":
            display_status = "error"
        else:
            display_status = "ok"
        results.append({
            "name": name,
            "ts": ts,
            "staleness_s": round(staleness_s, 1),
            "status": display_status,
            "last_error": data.get("last_error"),
        })

    results.sort(key=lambda x: x["name"])
    return {"pollers": results}


@router.get("/ingestion-rate")
async def get_ingestion_rate(
    window_minutes: int = Query(default=60, ge=5, le=1440),
    db: AsyncSession = Depends(get_db),
):
    """Per-entity-type observation counts bucketed by minute for the last N minutes."""
    rows = await db.execute(
        text("""
            SELECT
                date_trunc('minute', o.ts) AS bucket,
                e.entity_type,
                COUNT(*) AS obs_count
            FROM observations o
            JOIN entities e USING (entity_id)
            WHERE o.ts > now() - make_interval(mins => :window)
            GROUP BY 1, 2
            ORDER BY 1
        """),
        {"window": window_minutes},
    )
    buckets = [
        {
            "minute": row.bucket.isoformat(),
            "type": row.entity_type,
            "count": row.obs_count,
        }
        for row in rows
    ]
    return {"window_minutes": window_minutes, "buckets": buckets}


@router.get("/signal-quality")
async def get_signal_quality(
    window_minutes: int = Query(default=60, ge=5, le=1440),
    db: AsyncSession = Depends(get_db),
):
    """Average signal quality per entity type over the last N minutes.
    Only entity types that report signal_quality are included."""
    rows = await db.execute(
        text("""
            SELECT
                e.entity_type,
                AVG(o.signal_quality)::float            AS avg_quality,
                PERCENTILE_CONT(0.5) WITHIN GROUP
                    (ORDER BY o.signal_quality)::float  AS median_quality,
                MIN(o.signal_quality)::float            AS min_quality,
                MAX(o.signal_quality)::float            AS max_quality,
                COUNT(*)                                AS sample_count
            FROM observations o
            JOIN entities e USING (entity_id)
            WHERE o.ts > now() - make_interval(mins => :window)
              AND o.signal_quality IS NOT NULL
            GROUP BY e.entity_type
            ORDER BY avg_quality DESC NULLS LAST
        """),
        {"window": window_minutes},
    )
    return {
        "window_minutes": window_minutes,
        "types": [
            {
                "entity_type": row.entity_type,
                "avg_quality": round(row.avg_quality, 2) if row.avg_quality is not None else None,
                "median_quality": round(row.median_quality, 2) if row.median_quality is not None else None,
                "min_quality": round(row.min_quality, 2) if row.min_quality is not None else None,
                "max_quality": round(row.max_quality, 2) if row.max_quality is not None else None,
                "sample_count": row.sample_count,
            }
            for row in rows
        ],
    }


@router.get("/entity-freshness")
async def get_entity_freshness(db: AsyncSession = Depends(get_db)):
    """Entity freshness by type — bucketed by time since last observation."""
    rows = await db.execute(
        text("""
            SELECT
                entity_type,
                COUNT(*)                                                             AS total,
                COUNT(*) FILTER (WHERE last_seen > now() - interval '5 minutes')    AS fresh_5m,
                COUNT(*) FILTER (WHERE last_seen <= now() - interval '5 minutes'
                                   AND last_seen > now() - interval '15 minutes')   AS recent_15m,
                COUNT(*) FILTER (WHERE last_seen <= now() - interval '15 minutes'
                                   AND last_seen > now() - interval '60 minutes')   AS stale_60m,
                COUNT(*) FILTER (WHERE last_seen <= now() - interval '60 minutes')  AS very_stale
            FROM entities
            GROUP BY entity_type
            ORDER BY total DESC
        """)
    )
    return {
        "types": [
            {
                "entity_type": row.entity_type,
                "total": row.total,
                "fresh_5m": row.fresh_5m,
                "recent_15m": row.recent_15m,
                "stale_60m": row.stale_60m,
                "very_stale": row.very_stale,
            }
            for row in rows
        ],
    }


@router.get("/db-pool")
async def get_db_pool():
    """SQLAlchemy async engine connection pool statistics."""
    from db.session import engine
    pool = engine.pool
    try:
        return {
            "pool_size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "invalid": pool.invalid() if hasattr(pool, "invalid") else 0,
        }
    except Exception as exc:
        return {"error": str(exc)}
