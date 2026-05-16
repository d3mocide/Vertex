"""
SNR threshold alert infrastructure for mesh links.

Tracks per-link SNR history and fires a mesh_link_degraded event when a
link drops below its configured threshold.  Cooldown gating (same pattern
as geofence.py) prevents alert floods from rapidly-oscillating links.
"""
import json
import logging
import time
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_DEFAULT_THRESHOLD: float = -90.0   # dBm
_DEFAULT_COOLDOWN: int = 300         # seconds
_CACHE_TTL: float = 60.0             # how long to cache DB threshold

# Per-link last-known SNR (for edge detection)
_prev_snr: dict[str, float] = {}
# Cooldown gate: link_key -> timestamp of last fired alert
_last_alert: dict[str, float] = {}
# Threshold cache per source_url
_threshold_cache: dict[str, float] = {}
_threshold_cache_ts: dict[str, float] = {}


async def _load_threshold(source_url: str) -> float:
    """Read per-source SNR threshold from DB, cached for _CACHE_TTL seconds."""
    now = time.monotonic()
    if now - _threshold_cache_ts.get(source_url, 0.0) < _CACHE_TTL:
        return _threshold_cache.get(source_url, _DEFAULT_THRESHOLD)
    try:
        from db import get_pool
        row = await get_pool().fetchrow(
            "SELECT snr_threshold FROM mesh_alert_configs "
            "WHERE source_url = $1 AND enabled = TRUE",
            source_url,
        )
        threshold = float(row["snr_threshold"]) if row else _DEFAULT_THRESHOLD
    except Exception:
        threshold = _DEFAULT_THRESHOLD
    _threshold_cache[source_url] = threshold
    _threshold_cache_ts[source_url] = now
    return threshold


async def check_link_degradation(
    source_url: str, node_a: str, node_b: str, snr: float
) -> None:
    """Call after each link upsert.

    Fires a mesh_link_degraded event on the falling edge (SNR was OK,
    now below threshold), subject to per-link cooldown.
    """
    link_key = f"{source_url}:{node_a}->{node_b}"
    threshold = await _load_threshold(source_url)
    prev = _prev_snr.get(link_key)
    _prev_snr[link_key] = snr

    # Only fire on falling edge: previous reading was above threshold
    if prev is None or prev < threshold:
        return
    if snr >= threshold:
        return

    # Cooldown gate
    now_ts = time.time()
    if now_ts - _last_alert.get(link_key, 0.0) < _DEFAULT_COOLDOWN:
        return
    _last_alert[link_key] = now_ts

    await _emit_degradation_event(source_url, node_a, node_b, snr, threshold)


async def _emit_degradation_event(
    source_url: str, node_a: str, node_b: str, current_snr: float, threshold: float
) -> None:
    event_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    summary = (
        f"Mesh link degraded: {node_a} ↔ {node_b} "
        f"SNR {current_snr:.1f} dBm (threshold {threshold:.1f})"
    )
    details = {
        "source_url": source_url,
        "node_a": node_a,
        "node_b": node_b,
        "snr": current_snr,
        "threshold": threshold,
    }

    try:
        from db import get_pool
        await get_pool().execute(
            """
            INSERT INTO events
                (event_id, event_type, entity_id, ts, severity, summary, details)
            VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
            """,
            event_id,
            "mesh_link_degraded",
            node_a,
            "warning",
            summary,
            json.dumps(details),
        )
    except Exception as exc:
        logger.warning("[mesh_alerts] failed to write event row: %s", exc)

    try:
        from bus import get_bus
        r = await get_bus()
        await r.publish(
            "civic:updates",
            json.dumps({
                "type": "event",
                "data": {
                    "event_id":   event_id,
                    "event_type": "mesh_link_degraded",
                    "entity_id":  node_a,
                    "ts":         ts,
                    "severity":   "warning",
                    "summary":    summary,
                    "details":    details,
                },
            }),
        )
    except Exception as exc:
        logger.warning("[mesh_alerts] failed to publish event: %s", exc)

    logger.warning("[mesh_alerts] %s", summary)
