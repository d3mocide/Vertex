"""
Background task that snapshots Prometheus metrics every 10 seconds and
stores them in Redis as a rolling 60-minute history for the admin panel.
"""
import asyncio
import json
import logging
import time

logger = logging.getLogger(__name__)

_HISTORY_KEY = "metrics:history"
_HISTORY_LEN = 360  # 360 × 10 s = 60 minutes

# WebSocket client counter — mutated by routers/ws.py
_ws_client_count: int = 0


def ws_client_connect() -> None:
    global _ws_client_count
    _ws_client_count += 1


def ws_client_disconnect() -> None:
    global _ws_client_count
    _ws_client_count = max(0, _ws_client_count - 1)


def get_ws_client_count() -> int:
    return _ws_client_count


def collect_snapshot() -> dict:
    from prometheus_client import REGISTRY

    snap: dict = {"ts": time.time(), "ws_clients": _ws_client_count}

    for metric in REGISTRY.collect():
        name = metric.name
        samples = metric.samples
        if name == "http_request_duration_seconds":
            buckets: list[list] = []
            req_count = 0.0
            e5xx = 0.0
            for s in samples:
                if s.name.endswith("_bucket"):
                    le = float(s.labels.get("le", "inf"))
                    buckets.append([le, s.value])
                elif s.name.endswith("_count"):
                    req_count += s.value
                    status = s.labels.get("status") or s.labels.get("status_code") or ""
                    if str(status).startswith("5"):
                        e5xx += s.value

            if buckets:
                buckets.sort(key=lambda x: x[0])
                snap["latency_buckets"] = buckets
            snap["req_total"] = req_count
            snap["req_5xx"] = e5xx

        elif name == "process_resident_memory_bytes":
            if samples:
                snap["memory_bytes"] = samples[0].value

        elif name == "process_cpu_seconds_total":
            if samples:
                snap["cpu_seconds"] = samples[0].value

        elif name == "process_start_time_seconds":
            if samples:
                start_time = samples[0].value
                snap["uptime_seconds"] = time.time() - start_time

    return snap


def p95_from_buckets(buckets: list) -> float:
    """Return p95 latency in milliseconds from Prometheus histogram buckets."""
    if not buckets:
        return 0.0
    total = buckets[-1][1]
    if total == 0:
        return 0.0
    target = total * 0.95
    for i, (le, cnt) in enumerate(buckets):
        if cnt >= target:
            if i == 0:
                return le * 1000
            prev_le, prev_cnt = buckets[i - 1]
            if cnt == prev_cnt:
                return le * 1000
            frac = (target - prev_cnt) / (cnt - prev_cnt)
            return (prev_le + frac * (le - prev_le)) * 1000
    return 0.0


async def run_metrics_collector() -> None:
    from redis_bus import get_redis
    redis = get_redis()
    while True:
        try:
            snap = collect_snapshot()
            await redis.rpush(_HISTORY_KEY, json.dumps(snap))
            await redis.ltrim(_HISTORY_KEY, -_HISTORY_LEN, -1)
        except Exception as exc:
            logger.warning("[metrics] collection error: %s", exc)
        await asyncio.sleep(10)
