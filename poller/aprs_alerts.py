import json
import logging
import time
import uuid
from datetime import datetime, timezone

from sanitize import sanitize_payload, sanitize_text

logger = logging.getLogger(__name__)

_COOLDOWN_S = 300  # 5 minutes between repeated alerts per station
_last_alert: dict[str, float] = {}


async def emit_emergency_alert(entity: dict) -> None:
    """Write an aprs_emergency Event row and publish it to civic:updates.

    Rate-limited to one alert per entity per _COOLDOWN_S seconds so a
    continuously-beaconing emergency station doesn't flood the event log.
    """
    entity_id = entity.get("entity_id", "")
    now_ts = time.time()
    if now_ts - _last_alert.get(entity_id, 0.0) < _COOLDOWN_S:
        return
    _last_alert[entity_id] = now_ts

    callsign = (entity.get("identity") or {}).get("callsign") or entity_id
    event_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()

    event_type = sanitize_text("aprs_emergency") or ""
    eid        = sanitize_text(entity_id) or ""
    severity   = sanitize_text("critical") or ""
    summary    = sanitize_text(f"APRS EMERGENCY: {callsign}") or ""
    details    = sanitize_payload({
        "callsign": callsign,
        "lat": entity.get("lat"),
        "lon": entity.get("lon"),
    })

    from db import get_pool
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            INSERT INTO events (event_id, event_type, entity_id, ts, severity, summary, details)
            VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
            """,
            event_id,
            event_type,
            eid,
            severity,
            summary,
            json.dumps(details),
        )

    from bus import get_bus
    r = await get_bus()
    await r.publish(
        "civic:updates",
        json.dumps(sanitize_payload({
            "type": "event",
            "data": {
                "event_id":   event_id,
                "event_type": event_type,
                "entity_id":  eid,
                "ts":         ts,
                "severity":   severity,
                "summary":    summary,
                "details":    details,
            },
        })),
    )
    logger.warning("[aprs] %s", summary)
