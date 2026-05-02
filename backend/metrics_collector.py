"""
Background task that snapshots Prometheus metrics every 10 seconds and
stores them in Redis as a rolling 6-minute history for the admin panel.
"""
import asyncio
import json
import time

_HISTORY_KEY = "metrics:history"
_HISTORY_LEN = 36  # 36 × 10 s = 6 minutes


def collect_snapshot() -> dict:
    from prometheus_client import REGISTRY

    snap: dict = {"ts": time.time()}

    for metric in REGISTRY.collect():
        name = metric.name
        samples = metric.samples

        if name == "http_requests_total":
            total = 0.0
            e5xx = 0.0
            for s in samples:
                total += s.value
                if s.labels.get("status_code", "").startswith("5"):
                    e5xx += s.value
            snap["req_total"] = total
            snap["req_5xx"] = e5xx

        elif name == "http_request_duration_seconds":
            buckets: list[list] = []
            for s in samples:
                if s.name.endswith("_bucket"):
                    le = float(s.labels.get("le", "inf"))
                    buckets.append([le, s.value])
            if buckets:
                buckets.sort(key=lambda x: x[0])
                snap["latency_buckets"] = buckets

        elif name == "process_resident_memory_bytes":
            if samples:
                snap["memory_bytes"] = samples[0].value

        elif name == "process_cpu_seconds_total":
            if samples:
                snap["cpu_seconds"] = samples[0].value

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
        except Exception:
            pass
        await asyncio.sleep(10)
