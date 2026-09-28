import json
import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Entity, Observation, Event
from deps import get_db, get_redis_client
from metrics_collector import HISTORY_KEY_PREFIX, p95_from_buckets

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


_STORAGE_CACHE_KEY = "cache:admin_storage"
_STORAGE_CACHE_S = 300


@router.get("/storage", response_model=StorageStats)
async def get_storage(db: AsyncSession = Depends(get_db)):
    # Full-table counts over millions of observations take seconds: cache them.
    r = get_redis_client()
    cached = await r.get(_STORAGE_CACHE_KEY)
    if cached:
        stats = StorageStats.model_validate_json(cached)
        raw = await r.get(_RETENTION_KEY)   # may have just been changed
        stats.retention_days = int(raw) if raw else _DEFAULT_RETENTION_DAYS
        return stats
    stats = await _compute_storage(db)
    await r.set(_STORAGE_CACHE_KEY, stats.model_dump_json(), ex=_STORAGE_CACHE_S)
    return stats


async def _compute_storage(db: AsyncSession) -> StorageStats:
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


def _worker_steps(snaps: list[dict]) -> list[dict]:
    """Per-interval rates from one worker's snapshots (its counters only
    ever grow, so a negative step is a restart and is skipped)."""
    steps = []
    for prev, curr in zip(snaps, snaps[1:]):
        dt = curr["ts"] - prev["ts"]
        d_req = curr.get("req_total", 0.0) - prev.get("req_total", 0.0)
        d_5xx = curr.get("req_5xx", 0.0) - prev.get("req_5xx", 0.0)
        d_cpu = curr.get("cpu_seconds", 0.0) - prev.get("cpu_seconds", 0.0)
        if dt <= 0 or d_req < 0 or d_cpu < 0:
            continue
        steps.append({
            "ts": curr["ts"], "dt": dt, "d_req": d_req, "d_5xx": max(d_5xx, 0.0), "d_cpu": d_cpu,
            "memory_bytes": curr.get("memory_bytes", 0.0),
            "p95_ms": p95_from_buckets(curr.get("latency_buckets", [])),
            "ws_clients": curr.get("ws_clients", 0),
        })
    return steps


@router.get("/metrics")
async def get_metrics(db: AsyncSession = Depends(get_db)):
    """Operational metrics with 60-minute sparkline history, summed over the
    backend's worker processes."""
    r = get_redis_client()
    workers: list[list[dict]] = []
    async for key in r.scan_iter(match=f"{HISTORY_KEY_PREFIX}*", count=100):
        raw_list = await r.lrange(key, 0, -1)
        if raw_list:
            workers.append([json.loads(x) for x in raw_list])

    if not workers:
        return {"available": False}

    now = time.time()
    live = [w for w in workers if now - w[-1]["ts"] < 30]   # still reporting
    steps = [_worker_steps(w) for w in workers]

    # Headline numbers: totals over each worker's whole window.
    total_reqs = sum(st["d_req"] for ws in steps for st in ws)
    total_5xx = sum(st["d_5xx"] for ws in steps for st in ws)
    interval = max((w[-1]["ts"] - w[0]["ts"] for w in workers), default=0.0) or 10.0
    req_rate = total_reqs / interval
    error_pct = (total_5xx / total_reqs * 100) if total_reqs > 0 else 0.0
    # CPU: each worker's busy share over its own window, added up.
    cpu_pct = sum(
        sum(st["d_cpu"] for st in ws) / sum(st["dt"] for st in ws) * 100
        for ws in steps if ws
    )
    memory_mb = sum(w[-1].get("memory_bytes", 0.0) for w in live) / 1_048_576
    p95_ms = max((p95_from_buckets(w[-1].get("latency_buckets", [])) for w in live), default=0.0)
    ws_clients = sum(w[-1].get("ws_clients", 0) for w in live)
    uptime_seconds = max((w[-1].get("uptime_seconds") or 0 for w in live), default=None)

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

    # Sparklines: line each worker's steps up on the 10 s collection tick.
    buckets: dict[int, dict] = {}
    for ws in steps:
        for st in ws:
            b = buckets.setdefault(int(st["ts"] // 10), {
                "ts": st["ts"], "req_rate": 0.0, "d_req": 0.0, "d_5xx": 0.0,
                "memory_bytes": 0.0, "p95_ms": 0.0, "cpu_pct": 0.0, "ws_clients": 0,
            })
            b["req_rate"] += st["d_req"] / st["dt"]
            b["d_req"] += st["d_req"]
            b["d_5xx"] += st["d_5xx"]
            b["memory_bytes"] += st["memory_bytes"]
            b["p95_ms"] = max(b["p95_ms"], st["p95_ms"])
            b["cpu_pct"] += st["d_cpu"] / st["dt"] * 100
            b["ws_clients"] += st["ws_clients"]
    history = [{
        "ts": b["ts"],
        "req_rate": round(b["req_rate"], 3),
        "error_pct": round((b["d_5xx"] / b["d_req"] * 100) if b["d_req"] > 0 else 0.0, 1),
        "memory_mb": round(b["memory_bytes"] / 1_048_576, 1),
        "p95_ms": round(b["p95_ms"], 1),
        "cpu_pct": round(b["cpu_pct"], 1),
        "ws_clients": b["ws_clients"],
    } for _, b in sorted(buckets.items())]

    return {
        "available": True,
        "req_rate": round(req_rate, 2),
        "error_pct": round(error_pct, 1),
        "memory_mb": round(memory_mb, 1),
        "cpu_pct": round(cpu_pct, 1),
        "p95_ms": round(p95_ms, 1),
        "ws_clients": ws_clients,
        "uptime_seconds": uptime_seconds,
        "db_ping_ms": db_ping_ms,
        "redis_ping_ms": redis_ping_ms,
        "history": history,
    }


_TYPE_TO_POLLER: dict[str, str] = {
    "aircraft": "adsb",
    "vessel": "ais",
    "mesh_node": "meshcore",
    "weather": "weather",
    "lightning": "lightning",
    "seismic": "seismic",
    "alert": "alerts",
    "news_article": "news",
    "aprs": "aprs",
    "traffic": "traffic",
    "rf_sensor": "mqtt",
    "fire_incident": "fire",
    "stream_gauge": "streamgauge",
}


@router.get("/pollers")
async def get_pollers(db: AsyncSession = Depends(get_db)):
    """Poller heartbeat health grid with obs/min from DB and error counts from Redis."""
    r = get_redis_client()
    raw_map: dict[str, str] = await r.hgetall(_HEARTBEAT_KEY)
    now = time.time()

    # Obs counts per entity type over last 5 min → obs/min per poller
    obs_rows = await db.execute(
        text("""
            SELECT e.entity_type, COUNT(*) AS cnt
            FROM observations o
            JOIN entities e USING (entity_id)
            WHERE o.ts > now() - interval '5 minutes'
            GROUP BY e.entity_type
        """)
    )
    obs_by_poller: dict[str, float] = {}
    for row in obs_rows:
        poller_name = _TYPE_TO_POLLER.get(row.entity_type)
        if poller_name:
            obs_by_poller[poller_name] = obs_by_poller.get(poller_name, 0.0) + row.cnt / 5.0

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
            "obs_per_min": round(obs_by_poller.get(name, 0.0), 1),
            "error_count": data.get("error_count", 0),
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


@router.get("/talkgroup-activity")
async def get_talkgroup_activity(
    window_hours: int = Query(default=24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Calls per talkgroup over the last N hours, derived from p25_call_start events."""
    rows = await db.execute(
        text("""
            SELECT
                details->>'tgid'  AS tgid,
                details->>'tag'   AS tag,
                COUNT(*)          AS call_count
            FROM events
            WHERE event_type = 'p25_call_start'
              AND ts > now() - make_interval(hours => :hours)
              AND details->>'tgid' IS NOT NULL
            GROUP BY details->>'tgid', details->>'tag'
            ORDER BY call_count DESC
            LIMIT 20
        """),
        {"hours": window_hours},
    )
    return {
        "window_hours": window_hours,
        "talkgroups": [
            {
                "talkgroup_id": row.tgid,
                "label": row.tag or None,
                "call_count": row.call_count,
            }
            for row in rows
        ],
    }


@router.get("/mesh-battery")
async def get_mesh_battery(db: AsyncSession = Depends(get_db)):
    """Battery level for all tracked mesh nodes that report it."""
    rows = await db.execute(
        text("""
            SELECT
                entity_id,
                COALESCE(identity->>'name', identity->>'node_id', entity_id) AS label,
                (identity->>'battery_level')::int                            AS battery_level
            FROM entities
            WHERE entity_type = 'mesh_node'
              AND identity->>'battery_level' IS NOT NULL
            ORDER BY (identity->>'battery_level')::int DESC
        """)
    )
    return {
        "nodes": [
            {
                "entity_id": row.entity_id,
                "label": row.label,
                "battery_level": row.battery_level,
            }
            for row in rows
        ]
    }


@router.get("/data-quality")
async def get_data_quality(db: AsyncSession = Depends(get_db)):
    """Data completeness over the last 24 h: % of entities seen (or
    observations made) in that window with key fields populated. All-time
    counts were dominated by long-gone aircraft and took seconds to compute."""
    rows = await db.execute(
        text("""
            SELECT
                'Aircraft speed'    AS label,
                'aircraft'          AS entity_type,
                'speed'             AS field,
                COUNT(DISTINCT e.entity_id) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM observations o
                        WHERE o.entity_id = e.entity_id AND o.ts > now() - interval '24 hours' AND o.speed IS NOT NULL
                    )
                ) AS present,
                COUNT(DISTINCT e.entity_id) AS total
            FROM entities e
            WHERE e.last_seen > now() - interval '24 hours' AND e.entity_type = 'aircraft'
            UNION ALL
            SELECT
                'Aircraft heading'  AS label,
                'aircraft'          AS entity_type,
                'heading'           AS field,
                COUNT(DISTINCT e.entity_id) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM observations o
                        WHERE o.entity_id = e.entity_id AND o.ts > now() - interval '24 hours' AND o.heading IS NOT NULL
                    )
                ) AS present,
                COUNT(DISTINCT e.entity_id) AS total
            FROM entities e
            WHERE e.last_seen > now() - interval '24 hours' AND e.entity_type = 'aircraft'
            UNION ALL
            SELECT
                'Vessel name'       AS label,
                'vessel'            AS entity_type,
                'ship_name'         AS field,
                COUNT(DISTINCT e.entity_id) FILTER (
                    WHERE (e.identity->>'ship_name') IS NOT NULL 
                      AND (e.identity->>'ship_name') != ''
                ) AS present,
                COUNT(DISTINCT e.entity_id) AS total
            FROM entities e
            WHERE e.last_seen > now() - interval '24 hours' AND e.entity_type = 'vessel'
            UNION ALL
            SELECT
                'Vessel MMSI'       AS label,
                'vessel'            AS entity_type,
                'mmsi'              AS field,
                COUNT(DISTINCT e.entity_id) FILTER (
                    WHERE (e.identity->>'mmsi') IS NOT NULL
                ) AS present,
                COUNT(DISTINCT e.entity_id) AS total
            FROM entities e
            WHERE e.last_seen > now() - interval '24 hours' AND e.entity_type = 'vessel'
            UNION ALL
            SELECT
                'Mesh battery'      AS label,
                'mesh_node'         AS entity_type,
                'battery_level'     AS field,
                COUNT(DISTINCT e.entity_id) FILTER (
                    WHERE (e.identity->>'battery_level') IS NOT NULL
                ) AS present,
                COUNT(DISTINCT e.entity_id) AS total
            FROM entities e
            WHERE e.last_seen > now() - interval '24 hours' AND e.entity_type = 'mesh_node'
            UNION ALL
            SELECT
                'Aircraft signal quality' AS label,
                'aircraft'          AS entity_type,
                'signal_quality'    AS field,
                COUNT(*) FILTER (WHERE signal_quality IS NOT NULL) AS present,
                COUNT(*)            AS total
            FROM observations
            WHERE ts > now() - interval '24 hours' AND entity_id IN (SELECT entity_id FROM entities WHERE entity_type = 'aircraft')
            UNION ALL
            SELECT
                'Vessel signal quality' AS label,
                'vessel'            AS entity_type,
                'signal_quality'    AS field,
                COUNT(*) FILTER (WHERE signal_quality IS NOT NULL) AS present,
                COUNT(*)            AS total
            FROM observations
            WHERE ts > now() - interval '24 hours' AND entity_id IN (SELECT entity_id FROM entities WHERE entity_type = 'vessel')
        """)
    )
    result = []
    for row in rows:
        pct = round(row.present / row.total * 100, 1) if row.total > 0 else 0.0
        result.append({
            "label": row.label,
            "entity_type": row.entity_type,
            "field": row.field,
            "present": row.present,
            "total": row.total,
            "pct": pct,
        })
    return {"rows": result}


@router.get("/squawk-alerts")
async def get_squawk_alerts(
    window_hours: int = Query(default=24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """Count of emergency squawk codes (7500/7600/7700) seen in the last N hours."""
    rows = await db.execute(
        text("""
            SELECT
                identity->>'squawk' AS squawk,
                COUNT(*) AS entity_count
            FROM entities
            WHERE entity_type = 'aircraft'
              AND identity->>'squawk' IN ('7500', '7600', '7700')
              AND last_seen > now() - make_interval(hours => :hours)
            GROUP BY identity->>'squawk'
        """),
        {"hours": window_hours},
    )
    counts = {row.squawk: row.entity_count for row in rows}
    return {
        "window_hours": window_hours,
        "squawk_7500": counts.get("7500", 0),
        "squawk_7600": counts.get("7600", 0),
        "squawk_7700": counts.get("7700", 0),
        "total": sum(counts.values()),
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
