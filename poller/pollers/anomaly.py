"""
Anomaly detection poller.

Samples entity counts every 5 minutes and compares them against a rolling
statistical baseline (mean ± σ over the configured window). Anomalies are
published to Redis as 'anomaly_event' messages and persisted as Event rows.
"""

import asyncio
import json
import logging
import math
import time
from collections import deque
from datetime import datetime, timezone
from typing import NamedTuple

from bus import get_bus
from config import settings
from db import get_pool, write_event
from sanitize import sanitize_payload
from .base import BasePoller

logger = logging.getLogger(__name__)

_SAMPLE_INTERVAL = 300  # 5 minutes
_CHANNEL = "anomaly_event"


class _Sample(NamedTuple):
    ts: float
    aircraft: int
    vessel: int
    mesh_node: int
    aprs: int
    fire_incident: int


def _mean_std(vals: list[float]) -> tuple[float, float]:
    if len(vals) < 2:
        return (vals[0] if vals else 0.0), 0.0
    n = len(vals)
    mean = sum(vals) / n
    variance = sum((v - mean) ** 2 for v in vals) / (n - 1)
    return mean, math.sqrt(variance)


async def _count_entities(pool) -> dict[str, int]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT entity_type, COUNT(*) AS cnt
            FROM entities
            WHERE last_seen > NOW() - INTERVAL '10 minutes'
            GROUP BY entity_type
            """
        )
    return {r["entity_type"]: r["cnt"] for r in rows}


async def _insert_anomaly_event(pool, entity_type: str, description: str) -> None:
    try:
        await write_event(
            event_type="anomaly",
            entity_id=None,
            severity="high",
            summary=description,
            details={"anomaly_type": entity_type},
        )
    except Exception as exc:
        logger.warning("[anomaly] DB insert failed: %s", exc)


class AnomalyDetectionPoller(BasePoller):
    name = "anomaly"
    interval = _SAMPLE_INTERVAL

    def __init__(self) -> None:
        window_samples = max(
            4,
            (settings.anomaly_window_minutes * 60) // _SAMPLE_INTERVAL,
        )
        self._history: deque[_Sample] = deque(maxlen=window_samples)

    async def poll(self) -> None:
        if not settings.anomaly_enabled:
            return

        pool = get_pool()
        counts = await _count_entities(pool)

        sample = _Sample(
            ts=time.time(),
            aircraft=counts.get("aircraft", 0),
            vessel=counts.get("vessel", 0),
            mesh_node=counts.get("mesh_node", 0),
            aprs=counts.get("aprs", 0),
            fire_incident=counts.get("fire_incident", 0),
        )
        self._history.append(sample)

        # Need at least 4 samples before emitting anomalies
        if len(self._history) < 4:
            return

        r = await get_bus()
        threshold = settings.anomaly_sigma_threshold

        for field in ("aircraft", "vessel", "mesh_node", "aprs", "fire_incident"):
            current = getattr(sample, field)
            baseline = [getattr(s, field) for s in list(self._history)[:-1]]
            mean, std = _mean_std(baseline)

            # Skip if std is negligible (no variation → no meaningful anomaly)
            if std < 0.5:
                continue

            deviation = abs(current - mean)
            if deviation < threshold * std:
                continue

            direction = "spike" if current > mean else "drop"
            description = (
                f"{field} count {direction}: {current} vs baseline "
                f"{mean:.1f}±{std:.1f} ({deviation / std:.1f}σ)"
            )
            logger.warning("[anomaly] %s", description)

            event = {
                "event_type": "anomaly",
                "entity_type": field,
                "severity": "high",
                "description": description,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            try:
                await r.publish(_CHANNEL, json.dumps(sanitize_payload(event)))
            except Exception as exc:
                logger.debug("[anomaly] Redis publish failed: %s", exc)

            await _insert_anomaly_event(pool, field, description)
