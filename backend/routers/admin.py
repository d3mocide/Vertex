import json
import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import admin_health
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
    oldest_observation_at: str | None = None
    oldest_age_days: float | None = None
    last_purge: dict | None = None
    health: dict | None = None
    steady_state: dict | None = None
    table_sizes: list[dict] = []


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
        await _apply_health(stats, r)
        return stats
    stats = await _compute_storage(db)
    await r.set(_STORAGE_CACHE_KEY, stats.model_dump_json(), ex=_STORAGE_CACHE_S)
    await _apply_health(stats, r)
    return stats


async def _apply_health(stats: StorageStats, r) -> None:
    """Judge purge health from the (cached) oldest observation, the *current* retention setting and the
    poller's last recorded purge, so a retention change takes effect without waiting for the cache."""
    if stats.oldest_observation_at:
        from datetime import datetime, timezone
        oldest = datetime.fromisoformat(stats.oldest_observation_at)
        stats.oldest_age_days = (datetime.now(timezone.utc) - oldest).total_seconds() / 86400
    raw = await r.get("metrics:last_purge")
    stats.last_purge = json.loads(raw) if raw else None
    stats.health = admin_health.storage_health(stats.oldest_age_days, stats.retention_days, stats.last_purge, time.time())
    stats.steady_state = admin_health.steady_state_estimate(
        stats.obs_per_day_7d, stats.retention_days, stats.table_size_bytes, stats.observation_count)


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

    # Oldest observation: with retention working, this sits right at the retention age.
    oldest = await db.scalar(select(func.min(Observation.ts)))

    # Where the space goes.
    size_rows = await db.execute(text("""
        SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY 2 DESC LIMIT 6"""))
    table_sizes = [{"name": r.name, "bytes": int(r.bytes)} for r in size_rows]

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
        oldest_observation_at=oldest.isoformat() if oldest else None,
        table_sizes=table_sizes,
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


_ACTIVITY_CACHE_KEY = "cache:admin_entity_activity"
_ACTIVITY_CACHE_S = 60
_ACTIVE_NOW_MIN = 15


async def _compute_entity_activity(db: AsyncSession) -> dict:
    rows = await db.execute(
        text(f"""
            SELECT
                entity_type,
                COUNT(*)                                                                   AS registry_total,
                COUNT(*) FILTER (WHERE last_seen > now() - interval '{_ACTIVE_NOW_MIN} minutes') AS active_now,
                COUNT(*) FILTER (WHERE last_seen > now() - interval '24 hours')            AS seen_24h,
                EXTRACT(EPOCH FROM (now() - MAX(last_seen)))                               AS newest_age_s
            FROM entities
            GROUP BY entity_type
        """)
    )
    types = {r.entity_type: r for r in rows}
    # Distinct entities seen in each of the last 24 hours, per type: the shape of the day at a glance.
    hourly_rows = await db.execute(
        text("""
            SELECT e.entity_type,
                   FLOOR(EXTRACT(EPOCH FROM (date_trunc('hour', now()) - date_trunc('hour', o.ts))) / 3600)::int AS hours_ago,
                   COUNT(DISTINCT o.entity_id) AS n
            FROM observations o JOIN entities e USING (entity_id)
            WHERE o.ts > date_trunc('hour', now()) - interval '23 hours'
            GROUP BY 1, 2
        """)
    )
    hourly: dict[str, list[int]] = {t: [0] * 24 for t in types}
    for r in hourly_rows:
        if r.entity_type in hourly and 0 <= r.hours_ago < 24:
            hourly[r.entity_type][23 - r.hours_ago] = r.n     # oldest first, current hour last

    out = []
    for name, r in types.items():
        newest = None if r.newest_age_s is None else float(r.newest_age_s)
        series = hourly[name]
        out.append({
            "entity_type": name,
            "active_now": r.active_now,
            "seen_24h": r.seen_24h,
            "dormant": r.registry_total - r.seen_24h,
            "registry_total": r.registry_total,
            "hourly": series,
            "peak_hour": max(series),
            "newest_age_s": None if newest is None else round(newest),
            **admin_health.type_liveness(name, newest),
        })
    out.sort(key=lambda t: (-t["seen_24h"], -t["registry_total"]))
    out.extend(await _dispatch_rows(db))
    return {"types": out, "active_window_min": _ACTIVE_NOW_MIN}


async def _dispatch_rows(db: AsyncSession) -> list[dict]:
    """Radio calls and the dispatch incidents extracted from them, tracked like the map entities."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    rows: list[dict] = []

    call = (await db.execute(text(f"""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE started_at > now() - interval '{_ACTIVE_NOW_MIN} minutes') AS recent,
               COUNT(*) FILTER (WHERE transcription IS NOT NULL AND transcription <> '') AS transcribed,
               AVG(duration_s) AS avg_dur,
               EXTRACT(EPOCH FROM (now() - MAX(started_at))) AS newest_age_s
        FROM p25_recordings WHERE started_at > now() - interval '24 hours'"""))).one()
    hours = [0] * 24
    for r in await db.execute(text("""
        SELECT FLOOR(EXTRACT(EPOCH FROM (date_trunc('hour', now()) - date_trunc('hour', started_at))) / 3600)::int AS hours_ago,
               COUNT(*) AS n
        FROM p25_recordings WHERE started_at > date_trunc('hour', now()) - interval '23 hours' GROUP BY 1""")):
        if 0 <= r.hours_ago < 24:
            hours[23 - r.hours_ago] = r.n
    rows.append({
        "entity_type": "radio_call", "label": "Radio calls", "group": "dispatch",
        "active_now": call.recent, "active_window_min": _ACTIVE_NOW_MIN, "seen_24h": call.total, "dormant": 0,
        "registry_total": call.total, "hourly": hours, "peak_hour": max(hours),
        "newest_age_s": None if call.newest_age_s is None else round(float(call.newest_age_s)),
        "continuous": False, "live": None, "live_window_min": None,
        "extra": {"transcribed_pct": admin_health.pct(call.transcribed, call.total),
                  "avg_duration_s": None if call.avg_dur is None else round(float(call.avg_dur), 1)},
    })

    incidents: list[dict] = []
    try:
        raw = await get_redis_client().get("feed:radio:incidents")
        incidents = (json.loads(raw).get("incidents") or []) if raw else []
    except Exception:
        incidents = []
    d = admin_health.dispatch_activity(incidents, now)
    rows.append({
        "entity_type": "dispatch_incident", "label": "Dispatch incidents", "group": "dispatch",
        "active_now": d["active_now"], "active_window_min": admin_health.DISPATCH_ACTIVE_WINDOW_MIN,
        "seen_24h": d["seen_24h"], "dormant": 0, "registry_total": d["seen_24h"], "hourly": d["hourly"],
        "peak_hour": max(d["hourly"]), "newest_age_s": d["newest_age_s"],
        "continuous": False, "live": None, "live_window_min": None,
        "extra": {"located_pct": d["located_pct"], "life_safety": d["life_safety"], "categories": d["categories"]},
    })
    return rows


@router.get("/entity-activity")
async def get_entity_activity(db: AsyncSession = Depends(get_db)):
    """What is active on the map, by entity type: how many are being seen right now, how many in the last 24 h,
    and the hourly shape of the day. (Per-entity "freshness" was the wrong question: aircraft, vessels and mesh
    nodes naturally come and go, so most of a day's entities are always "old".) `live` says whether a feed that
    should be continuous is delivering, judged by the newest sighting of its type. Entities not seen in 24 h are
    `dormant`: the entity table is a registry that is never pruned."""
    r = get_redis_client()
    cached = await r.get(_ACTIVITY_CACHE_KEY)
    if cached:
        return json.loads(cached)
    data = await _compute_entity_activity(db)
    await r.set(_ACTIVITY_CACHE_KEY, json.dumps(data), ex=_ACTIVITY_CACHE_S)
    return data


_EVENT_CACHE_KEY = "cache:admin_event_activity"


@router.get("/event-activity")
async def get_event_activity(db: AsyncSession = Depends(get_db)):
    """Events by type: the last 24 h with an hourly shape, next to the all-time total. (All-time totals alone were
    dominated by geofence crossings and said nothing about what is happening now.)"""
    r = get_redis_client()
    cached = await r.get(_EVENT_CACHE_KEY)
    if cached:
        return json.loads(cached)
    rows = await db.execute(text("""
        SELECT event_type, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE ts > now() - interval '24 hours') AS n24,
               COUNT(*) FILTER (WHERE ts > now() - interval '1 hour') AS n1
        FROM events GROUP BY event_type"""))
    types = {x.event_type: {"event_type": x.event_type, "total": x.total, "last_24h": x.n24, "last_hour": x.n1,
                            "hourly": [0] * 24} for x in rows}
    for x in await db.execute(text("""
        SELECT event_type,
               FLOOR(EXTRACT(EPOCH FROM (date_trunc('hour', now()) - date_trunc('hour', ts))) / 3600)::int AS hours_ago,
               COUNT(*) AS n
        FROM events WHERE ts > date_trunc('hour', now()) - interval '23 hours' GROUP BY 1, 2""")):
        if x.event_type in types and 0 <= x.hours_ago < 24:
            types[x.event_type]["hourly"][23 - x.hours_ago] = x.n
    out = sorted(types.values(), key=lambda t: (-t["last_24h"], -t["total"]))
    data = {"types": out, "total": sum(t["total"] for t in out), "last_24h": sum(t["last_24h"] for t in out)}
    await r.set(_EVENT_CACHE_KEY, json.dumps(data), ex=60)
    return data


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
    result.extend(await _dispatch_quality_rows(db))
    return {"rows": result}


async def _dispatch_quality_rows(db: AsyncSession) -> list[dict]:
    """How well the radio pipeline is doing: calls that got a transcript, incidents that got a map location."""
    rows = []
    call = (await db.execute(text("""
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE transcription IS NOT NULL AND transcription <> '') AS present
        FROM p25_recordings WHERE started_at > now() - interval '24 hours'"""))).one()
    if call.total:
        rows.append({"label": "Radio calls - Transcribed", "entity_type": "radio_call", "field": "transcription",
                     "present": call.present, "total": call.total, "pct": admin_health.pct(call.present, call.total)})
    try:
        raw = await get_redis_client().get("feed:radio:incidents")
        incidents = (json.loads(raw).get("incidents") or []) if raw else []
    except Exception:
        incidents = []
    if incidents:
        located = sum(1 for i in incidents if i.get("lat") is not None and i.get("lon") is not None)
        rows.append({"label": "Dispatch incidents - Located on map", "entity_type": "dispatch_incident", "field": "lat/lon",
                     "present": located, "total": len(incidents), "pct": admin_health.pct(located, len(incidents))})
    return rows


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


_FEED_COUNTS_KEY = "cache:admin_feed_counts"
_FEED_COUNTS_S = 60


def _item_count(value) -> int | None:
    """How many records a feed snapshot holds (None when it is not a list of records)."""
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        for k in ("features", "aircraft", "incidents", "strikes", "items", "data"):
            if isinstance(value.get(k), list):
                return len(value[k])
    return None


async def _feed_item_counts(r, keys: list[str]) -> dict[str, int | None]:
    """Record counts per feed. Parsing every snapshot is not free, so it is cached briefly."""
    cached = await r.get(_FEED_COUNTS_KEY)
    if cached:
        return json.loads(cached)
    counts: dict[str, int | None] = {}
    for key in keys:
        raw = await r.get(f"feed:{key}")
        try:
            counts[key] = _item_count(json.loads(raw)) if raw else None
        except Exception:
            counts[key] = None
    await r.set(_FEED_COUNTS_KEY, json.dumps(counts), ex=_FEED_COUNTS_S)
    return counts


@router.get("/overview")
async def get_overview(db: AsyncSession = Depends(get_db)):
    """One call that answers "is anything wrong?": service details, every data source's freshness against how
    often it should update, and the list of things that need attention (most severe first)."""
    from datetime import datetime, timezone
    from routers.health import _FEED_MAX_AGE_S

    r = get_redis_client()
    now = time.time()

    metrics = await get_metrics(db)
    pollers = (await get_pollers(db)).get("pollers", [])
    storage = await get_storage(db)
    pool = await get_db_pool()
    activity = (await get_entity_activity(db))["types"]

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    postgres: dict = {"ping_ms": metrics.get("db_ping_ms", -1.0) if metrics.get("available") else None}
    try:
        row = (await db.execute(text(
            "SELECT pg_database_size(current_database()) AS size, "
            "(SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS conns, "
            "current_setting('max_connections')::int AS max_conns"))).one()
        postgres.update(size_bytes=int(row.size), connections=int(row.conns), max_connections=int(row.max_conns))
        if postgres["ping_ms"] is None:
            postgres["ping_ms"] = 0.0
    except Exception:
        postgres["ping_ms"] = -1.0

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_info: dict = {"ping_ms": metrics.get("redis_ping_ms", -1.0) if metrics.get("available") else None}
    try:
        info = await r.info()
        redis_info.update(used_memory_bytes=int(info.get("used_memory", 0)), max_memory_bytes=int(info.get("maxmemory", 0)),
                          clients=int(info.get("connected_clients", 0)), keys=int(await r.dbsize()))
        if redis_info["ping_ms"] is None:
            redis_info["ping_ms"] = 0.0
    except Exception:
        redis_info["ping_ms"] = -1.0

    # ── Data sources ──────────────────────────────────────────────────────────
    raw_meta = await r.hgetall("feed:meta")
    ages: dict[str, float] = {}
    for key, ts in raw_meta.items():
        key = key.decode() if isinstance(key, bytes) else key
        ts = ts.decode() if isinstance(ts, bytes) else ts
        try:
            ages[key] = (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).total_seconds()
        except ValueError:
            continue
    counts = await _feed_item_counts(r, sorted(ages))
    feeds = [admin_health.feed_row(k, a, _FEED_MAX_AGE_S.get(k), counts.get(k)) for k, a in ages.items()
             if k not in admin_health.HIDDEN_FEEDS]
    order = {"down": 0, "stale": 1, "ok": 2, "on_change": 3}
    feeds.sort(key=lambda f: (order[f["status"]], f["group"], f["label"]))

    # ── AI briefing and the local ADS-B receiver ─────────────────────────────
    briefing = None
    try:
        raw = await r.get("feed:summary:latest")
        if raw:
            b = json.loads(raw)
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(b["ts"])).total_seconds()
            briefing = {"age_s": round(age), "posture": b.get("posture"), "model": b.get("model"),
                        "duration_s": b.get("duration_s")}
    except Exception:
        briefing = None
    receiver = None
    try:
        raw = await r.get("feed:aircraft_snapshot")
        if raw:
            snap = json.loads(raw)
            receiver = {k: snap.get(k) for k in ("beast_connected", "beast_healthy", "last_frame_age_s", "count", "positioned", "frames_dropped")}
    except Exception:
        receiver = None

    poller_counts = {s: sum(1 for p in pollers if p["status"] == s) for s in ("ok", "stale", "error", "unknown")}
    quiet_pollers = sorted(pollers, key=lambda p: -p["staleness_s"])[:1]
    api = {k: metrics.get(k) for k in ("req_rate", "error_pct", "p95_ms", "memory_mb", "cpu_pct", "ws_clients", "uptime_seconds")} \
        if metrics.get("available") else None

    issues = admin_health.build_issues({
        "postgres": postgres, "redis": redis_info, "pollers": pollers, "feeds": feeds,
        "activity": activity, "storage": storage.health, "pool": pool if "level" in pool else None,
        "api": api, "briefing_age_s": briefing["age_s"] if briefing else None, "receiver": receiver,
    })
    return {
        "status": admin_health.overall_status(issues),
        "issues": issues,
        "checked_at": now,
        "services": {
            "postgres": postgres,
            "redis": redis_info,
            "api": api,
            "pollers": {"total": len(pollers), **poller_counts,
                        "slowest": ({"name": quiet_pollers[0]["name"], "staleness_s": quiet_pollers[0]["staleness_s"]}
                                    if quiet_pollers else None)},
            "briefing": briefing,
            "receiver": receiver,
        },
        "feeds": feeds,
    }


@router.get("/db-pool")
async def get_db_pool():
    """SQLAlchemy async engine connection pool statistics."""
    from db.session import engine
    pool = engine.pool
    try:
        max_overflow = int(getattr(pool, "_max_overflow", 10))
        out = {
            "pool_size": pool.size(),
            "max_overflow": max_overflow,
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "invalid": pool.invalid() if hasattr(pool, "invalid") else 0,
        }
        # One snapshot of one of the backend's worker processes: judged against the pool's real capacity.
        out.update(admin_health.pool_status(out["pool_size"], out["checked_out"], max_overflow))
        return out
    except Exception as exc:
        return {"error": str(exc)}
