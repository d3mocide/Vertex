import json
import logging
import uuid
import time
from datetime import datetime, timezone
from sanitize import sanitize_payload, sanitize_text

logger = logging.getLogger(__name__)

# entity_id -> geofence_id -> state
# state fields:
#   entered_at: datetime when entity first entered geofence
#   entry_emitted: whether geofence_entry has been emitted
_entity_state: dict[str, dict[int, dict[str, object]]] = {}

# entity_id -> last time (epoch s) the entity was checked. Eviction is by
# last-seen, NOT by fence state: evicting entities that were merely outside
# every fence made their next entry look like a first observation, which is
# silently seeded — so entries were almost never emitted while exits were
# (e.g. 10k exits vs 5 entries/week for transit vehicles).
_entity_last_seen: dict[str, float] = {}
_EVICT_AFTER_S = 6 * 3600
_EVICT_EVERY_S = 300.0
_last_eviction = 0.0

# Rate-limit PostGIS ST_Contains queries — run at most once per N seconds per entity.
# Aircraft update at 1-2 Hz from BEAST; a 30s gate cuts 97% of spatial queries.
_GEOFENCE_CHECK_INTERVAL = 30.0
_last_geofence_check: dict[str, float] = {}


def _evict_unseen(now_ts: float) -> None:
    """Forget entities not seen for _EVICT_AFTER_S (bounded memory), at most every few minutes."""
    global _last_eviction
    if now_ts - _last_eviction < _EVICT_EVERY_S:
        return
    _last_eviction = now_ts
    cutoff = now_ts - _EVICT_AFTER_S
    for eid in [e for e, seen in _entity_last_seen.items() if seen < cutoff]:
        _entity_last_seen.pop(eid, None)
        _entity_state.pop(eid, None)
        _last_geofence_check.pop(eid, None)


async def check_geofences(entity: dict, conn) -> None:
    """
    Query PostGIS for geofences containing this entity's position.
    Detect entry/exit transitions, write Event rows, and publish to Redis.
    Uses the caller's asyncpg connection so no extra pool acquire is needed.
    """
    lat = entity.get("lat")
    lon = entity.get("lon")
    entity_id = entity["entity_id"]

    if lat is None or lon is None:
        return

    now_ts = time.time()
    if now_ts - _last_geofence_check.get(entity_id, 0.0) < _GEOFENCE_CHECK_INTERVAL:
        return
    _last_geofence_check[entity_id] = now_ts
    _evict_unseen(now_ts)

    current_rows = await conn.fetch(
        """
        SELECT id, name, zone_type, geofence_shape, dwell_seconds
        FROM geofences
        WHERE active = TRUE
          -- "area" zones (city limits, corridors) only label incidents; they
          -- would otherwise emit an entry/exit for every overflight.
          AND zone_type <> 'area'
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1::float, $2::float), 4326))
        """,
        lon,
        lat,
    )

    now = datetime.now(timezone.utc)
    current_by_id = {r["id"]: dict(r) for r in current_rows}
    current_ids = set(current_by_id.keys())
    previous_state = _entity_state.get(entity_id)

    if previous_state is None:
        # First observation for this entity since startup — initialize state silently
        # to avoid a false-positive entry storm after a poller restart.
        _entity_state[entity_id] = {
            fid: {"entered_at": now, "entry_emitted": True}
            for fid in current_ids
        }
        _entity_last_seen[entity_id] = now_ts
        return

    state = previous_state
    entered_ids = current_ids - set(state.keys())
    exited_ids = set(state.keys()) - current_ids

    display = entity.get("display_name") or entity_id

    transitions: list[tuple[str, dict, str, str]] = []

    for fid in entered_ids:
        state[fid] = {"entered_at": now, "entry_emitted": False}

    for fid in current_ids:
        fence = current_by_id[fid]
        dwell_seconds = int(fence.get("dwell_seconds") or 0)
        entry_emitted = bool(state[fid].get("entry_emitted"))
        entered_at = state[fid].get("entered_at")
        if not isinstance(entered_at, datetime):
            entered_at = now
            state[fid]["entered_at"] = entered_at

        if entry_emitted:
            continue

        elapsed = (now - entered_at).total_seconds()
        if dwell_seconds <= 0 or elapsed >= dwell_seconds:
            transitions.append(("geofence_entry", fence, f"{display} entered {fence['name']}", "info"))
            state[fid]["entry_emitted"] = True

    if exited_ids:
        exited_rows = await conn.fetch(
            "SELECT id, name, zone_type, geofence_shape, dwell_seconds FROM geofences WHERE id = ANY($1::int[])",
            list(exited_ids),
        )
        for row in exited_rows:
            prev = state.get(row["id"], {})
            if prev.get("entry_emitted"):
                transitions.append(("geofence_exit", dict(row), f"{display} exited {row['name']}", "info"))
            state.pop(row["id"], None)

    _entity_state[entity_id] = state

    _entity_last_seen[entity_id] = now_ts

    from bus import get_bus  # lazy import — breaks the db→geofence→bus→db cycle

    r = await get_bus()
    ts = datetime.now(timezone.utc).isoformat()

    for event_type, fence, summary, severity in transitions:
        event_id = str(uuid.uuid4())
        details = sanitize_payload({
            "geofence_id":   fence["id"],
            "geofence_name": fence["name"],
            "zone_type":     fence["zone_type"],
            "geofence_shape": fence.get("geofence_shape", "polygon"),
            "dwell_seconds": int(fence.get("dwell_seconds") or 0),
        })
        event_type = sanitize_text(event_type) or ""
        entity_id = sanitize_text(entity_id) or ""
        severity = sanitize_text(severity) or ""
        summary = sanitize_text(summary) or ""

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
            json.dumps(sanitize_payload({
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
            })),
        )
        logger.info("[geofence] %s", summary)
