import json
import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# entity_id -> set of geofence ids the entity was last known to be inside
_entity_state: dict[str, set[int]] = {}


async def check_geofences(entity: dict, conn) -> None:
    """
    Query PostGIS for geofences containing this entity's position.
    Detect entry/exit transitions, write Event rows, and publish to Redis.
    Uses the caller's asyncpg connection so no extra pool acquire is needed.
    """
    lat = entity.get("lat")
    lon = entity.get("lon")
    entity_id = entity["entity_id"]

    current_rows = await conn.fetch(
        """
        SELECT id, name, zone_type
        FROM geofences
        WHERE active = TRUE
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1::float, $2::float), 4326))
        """,
        lon,
        lat,
    )

    current_ids = {r["id"] for r in current_rows}
    previous_ids = _entity_state.get(entity_id, set())

    entered_ids = current_ids - previous_ids
    exited_ids = previous_ids - current_ids

    _entity_state[entity_id] = current_ids

    if not entered_ids and not exited_ids:
        return

    display = entity.get("display_name") or entity_id
    current_by_id = {r["id"]: r for r in current_rows}

    transitions: list[tuple[str, dict, str, str]] = []

    for fid in entered_ids:
        fence = current_by_id[fid]
        transitions.append(("geofence_entry", dict(fence), f"{display} entered {fence['name']}", "info"))

    if exited_ids:
        exited_rows = await conn.fetch(
            "SELECT id, name, zone_type FROM geofences WHERE id = ANY($1::int[])",
            list(exited_ids),
        )
        for row in exited_rows:
            transitions.append(("geofence_exit", dict(row), f"{display} exited {row['name']}", "info"))

    from bus import get_bus  # lazy import — breaks the db→geofence→bus→db cycle

    r = await get_bus()
    ts = datetime.now(timezone.utc).isoformat()

    for event_type, fence, summary, severity in transitions:
        event_id = str(uuid.uuid4())
        details = {
            "geofence_id":   fence["id"],
            "geofence_name": fence["name"],
            "zone_type":     fence["zone_type"],
        }

        await conn.execute(
            """
            INSERT INTO events (event_id, event_type, entity_id, ts, severity, summary, details)
            VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
            """,
            event_id,
            event_type,
            entity_id,
            severity,
            summary,
            json.dumps(details),
        )

        await r.publish(
            "civic:updates",
            json.dumps({
                "type": "event",
                "data": {
                    "event_id":   event_id,
                    "event_type": event_type,
                    "entity_id":  entity_id,
                    "ts":         ts,
                    "severity":   severity,
                    "summary":    summary,
                    "details":    details,
                },
            }),
        )
        logger.info("[geofence] %s", summary)
