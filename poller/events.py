"""Write an event row and announce it on the update channel, the way the other alert sources do.

Events show in the Events log and replay, reach live clients over the websocket, and are what webhook alert rules
match on (backend/webhook_dispatcher.py reads them from the same channel)."""
import json
import logging
from datetime import datetime, timezone

import db
from bus import get_bus
from sanitize import sanitize_payload

logger = logging.getLogger(__name__)


async def emit_event(event_type: str, entity_id: str | None, severity: str, summary: str, details: dict,
                     dedupe: dict | None = None) -> str | None:
    """Persist and publish one event. With `dedupe` (details key/values), an event already recorded in the last 30
    days with the same values is not written again, so a restart does not repeat it. `entity_id` must be an existing
    entity or None: the events table references the entities table. Returns the event id, or None
    when it was a duplicate or could not be written. Never raises: an event must not take its caller down."""
    try:
        if dedupe and await db.event_recorded(event_type, dedupe):
            return None
        event_id = await db.write_event(event_type, entity_id, severity, summary, details)
        if not event_id:
            return None
        await (await get_bus()).publish("civic:updates", json.dumps(sanitize_payload({
            "type": "event",
            "data": {"event_id": event_id, "event_type": event_type, "entity_id": entity_id,
                     "ts": datetime.now(timezone.utc).isoformat(), "severity": severity,
                     "summary": summary, "details": details},
        })))
        return event_id
    except Exception as exc:
        logger.warning("[events] could not emit %s: %s", event_type, exc)
        return None
