"""Health judgments for the admin dashboards, kept pure so they can be tested.

The admin views used to make these calls in the browser from raw counts, and several of them measured the
wrong thing: a database that is pruning correctly was reported CRITICAL, and a registry of every aircraft ever
seen was reported as "stale". These helpers judge what actually indicates trouble.
"""
from __future__ import annotations

# Entity types that should be updating continuously, and how recent the newest sighting of the type must be for
# its feed to count as live (minutes). Anything else (fire incidents, which are event-driven and carry the
# agency's own timestamp) is shown but never counted against health.
LIVE_WINDOW_MIN: dict[str, int] = {
    "aircraft": 15, "vessel": 15, "aprs": 15, "train": 15, "mesh_node": 60, "stream_gauge": 90,
}

# Feed keys that duplicate another feed and would only add noise to the admin view.
HIDDEN_FEEDS = {"utility:pge"}

DOWN_FACTOR = 3                  # a feed is "down" once it is this many expected intervals late

PURGE_LAG_DEGRADED_DAYS = 2      # oldest data this far past retention: the daily purge is behind
PURGE_LAG_CRITICAL_DAYS = 7
PURGE_OVERDUE_HOURS = 48         # purge is meant to run daily


def storage_health(oldest_age_days: float | None, retention_days: int, last_purge: dict | None,
                   now_ts: float) -> dict:
    """Is old data being removed? At steady state the oldest observation sits right at the retention age: that is
    healthy. Trouble is data lingering well past retention, or a purge that stopped running."""
    purge_age_h = None
    if last_purge and isinstance(last_purge.get("ts"), (int, float)):
        purge_age_h = max(0.0, (now_ts - last_purge["ts"]) / 3600)

    base = {"oldest_age_days": None if oldest_age_days is None else round(oldest_age_days, 1),
            "last_purge_age_hours": None if purge_age_h is None else round(purge_age_h, 1)}
    if oldest_age_days is None:
        return {**base, "status": "ok", "message": "No observations stored yet."}

    lag = oldest_age_days - retention_days
    if lag > PURGE_LAG_CRITICAL_DAYS:
        return {**base, "status": "critical",
                "message": f"The purge is not keeping up: the oldest observation is {lag:.0f} days past the "
                           f"{retention_days}-day retention. Check the poller logs."}
    if lag > PURGE_LAG_DEGRADED_DAYS:
        return {**base, "status": "degraded",
                "message": f"The purge is behind: the oldest observation is {lag:.1f} days past the "
                           f"{retention_days}-day retention."}
    if purge_age_h is not None and purge_age_h > PURGE_OVERDUE_HOURS:
        return {**base, "status": "degraded",
                "message": f"The last purge ran {purge_age_h:.0f} hours ago; it should run daily."}
    return {**base, "status": "ok",
            "message": f"Purge is keeping up: the oldest observation is {oldest_age_days:.1f} days old "
                       f"(retention {retention_days} days)."}


def steady_state_estimate(obs_per_day: float, retention_days: int, table_size_bytes: int,
                          observation_count: int) -> dict:
    """What the observations table settles at for a retention setting, at the current ingest rate."""
    rows = int(obs_per_day * retention_days)
    bytes_per_row = (table_size_bytes / observation_count) if observation_count else 0
    return {"rows": rows, "bytes": int(rows * bytes_per_row)}


def type_liveness(entity_type: str, newest_age_s: float | None) -> dict:
    """Whether a continuous feed looks alive, judged by the newest sighting of its entity type."""
    window = LIVE_WINDOW_MIN.get(entity_type)
    if window is None:
        return {"continuous": False, "live": None, "live_window_min": None}
    live = newest_age_s is not None and newest_age_s <= window * 60
    return {"continuous": True, "live": live, "live_window_min": window}


def pool_status(pool_size: int, checked_out: int, max_overflow: int) -> dict:
    """Connection pool load against its real capacity (base pool plus the overflow it may open). Using the base
    size alone flagged a normal 4-of-5 snapshot even though 10 more connections were available."""
    capacity = max(pool_size + max_overflow, 1)
    utilization = checked_out / capacity
    if checked_out >= capacity:
        level, message = "critical", "Every connection is in use; requests may be waiting. Raise the pool size or reduce concurrent queries."
    elif utilization >= 0.8:
        level, message = "warn", f"{checked_out} of {capacity} connections in use. If this persists, raise the pool size."
    else:
        level, message = "ok", None
    in_overflow = max(0, checked_out - pool_size)
    return {"capacity": capacity, "utilization": round(utilization, 3), "level": level, "message": message,
            "overflow_in_use": in_overflow}


# ── data sources (feeds) ─────────────────────────────────────────────────────
# Friendly names and groups for the Redis feed keys the poller publishes. Unknown keys still show, by key.
FEED_INFO: dict[str, tuple[str, str]] = {
    "weather:current": ("Current conditions", "Weather"), "weather:forecast": ("Forecast", "Weather"),
    "weather:alerts": ("NWS alerts", "Weather"), "weather:stations": ("Nearby stations", "Weather"),
    "weather:rwis": ("Road-weather stations", "Weather"), "weather:nwws_products": ("NWS text products", "Weather"),
    "hydro:status": ("River gauges", "Weather"), "lightning:strikes": ("Lightning strikes", "Weather"),
    "fire:danger": ("Fire danger", "Fire"), "fire:perimeters": ("Fire perimeters", "Fire"),
    "fire:nifc_incidents": ("Wildfire incidents", "Fire"),
    "fire:hotspots": ("Satellite hotspots", "Fire"),
    "traffic:incidents": ("Road incidents", "Traffic"), "traffic:cameras": ("Cameras", "Traffic"),
    "traffic:signs": ("Message signs", "Traffic"), "traffic:flow": ("Detector flow", "Traffic"),
    "traffic:corridors": ("Freeway corridors", "Traffic"),
    "utility:outages": ("Power outages", "Utilities"), "utility:oregon": ("Outage summary", "Utilities"),
    "utility:pge": ("PGE summary (legacy)", "Utilities"),
    "radio:incidents": ("Radio incidents", "Radio"), "radio:active": ("Active radio call", "Radio"),
    "alerts:flash": ("FlashAlert", "Alerts & news"), "intel:alerts": ("Intel alerts", "Alerts & news"),
    "news:local": ("Local news", "Alerts & news"), "advisories": ("Advisories", "Alerts & news"),
    "summary:latest": ("AI briefing", "Briefing"), "mesh:status": ("Mesh repeater status", "Mesh"),
    "aircraft_snapshot": ("Aircraft snapshot", "Aircraft"),
}


def feed_row(key: str, age_s: float, max_age_s: int | None, items: int | None = None) -> dict:
    """One data source: how long since it last delivered, against how often it should.

    ok = within its expected interval; stale = up to three intervals late; down = longer than that. Feeds that only
    publish when something changes (no expected interval) are `on_change`: shown with their age, never alarmed."""
    label, group = FEED_INFO.get(key, (key, "Other"))
    if not max_age_s:
        status = "on_change"
    elif age_s <= max_age_s:
        status = "ok"
    elif age_s <= max_age_s * DOWN_FACTOR:
        status = "stale"
    else:
        status = "down"
    return {"key": key, "label": label, "group": group, "age_s": round(age_s), "max_age_s": max_age_s,
            "status": status, "items": items}


def _age(seconds: float) -> str:
    if seconds < 90:
        return f"{round(seconds)} s"
    if seconds < 5400:
        return f"{round(seconds / 60)} min"
    return f"{seconds / 3600:.1f} h"


_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


def build_issues(s: dict) -> list[dict]:
    """Everything worth a human's attention right now, most severe first. `s` carries whatever the caller has;
    missing pieces are simply skipped. Informational items never change the overall status."""
    issues: list[dict] = []

    def add(severity, area, title, detail, tab):
        issues.append({"severity": severity, "area": area, "title": title, "detail": detail, "tab": tab})

    pg = (s.get("postgres") or {}).get("ping_ms")
    if pg is not None:
        if pg < 0:
            add("critical", "database", "PostgreSQL is not responding", "Nothing can be stored or read.", "system")
        elif pg > 100:
            add("warning", "database", "PostgreSQL is slow", f"A trivial query took {pg:.0f} ms.", "storage")
    rd = (s.get("redis") or {}).get("ping_ms")
    if rd is not None:
        if rd < 0:
            add("critical", "redis", "Redis is not responding", "Live updates and feed caches are unavailable.", "system")
        elif rd > 50:
            add("warning", "redis", "Redis is slow", f"A ping took {rd:.0f} ms.", "system")

    for p in s.get("pollers") or []:
        if p.get("status") == "error":
            add("warning", "pollers", f"Poller {p['name']} is reporting errors",
                (p.get("last_error") or "No detail recorded.")[:160], "ingestion")
        elif p.get("status") == "stale":
            add("warning", "pollers", f"Poller {p['name']} stopped checking in",
                f"No heartbeat for {_age(p.get('staleness_s') or 0)}.", "ingestion")

    late = [f for f in s.get("feeds") or [] if f.get("status") in ("stale", "down")]
    if late:
        names = ", ".join(f["label"] for f in late[:5]) + (f" and {len(late) - 5} more" if len(late) > 5 else "")
        add("warning", "feeds", f"{len(late)} data feed{'s' if len(late) != 1 else ''} running late", names, "system")

    for t in s.get("activity") or []:
        if t.get("continuous") and t.get("live") is False:
            newest = t.get("newest_age_s")
            add("warning", "ingest", f"No new {t['entity_type'].replace('_', ' ')} data",
                f"Newest sighting was {_age(newest)} ago." if newest is not None else "Nothing seen yet.", "quality")

    st = s.get("storage") or {}
    if st.get("status") in ("degraded", "critical"):
        add("critical" if st["status"] == "critical" else "warning", "storage", "Old data is not being purged",
            st.get("message", ""), "storage")
    pool = s.get("pool") or {}
    if pool.get("level") in ("warn", "critical"):
        add("critical" if pool["level"] == "critical" else "warning", "database", "Database connections running high",
            pool.get("message") or "", "storage")

    api = s.get("api") or {}
    if api.get("error_pct") is not None:
        if api["error_pct"] > 5 or api.get("p95_ms", 0) > 1000:
            add("critical", "api", "The API is failing or very slow",
                f"{api['error_pct']:.1f}% errors, p95 {api.get('p95_ms', 0):.0f} ms.", "system")
        elif api["error_pct"] > 2 or api.get("p95_ms", 0) > 500:
            add("warning", "api", "The API is degraded",
                f"{api['error_pct']:.1f}% errors, p95 {api.get('p95_ms', 0):.0f} ms.", "system")

    age = s.get("briefing_age_s")
    if age is not None and age > 3 * 3600:
        add("warning", "briefing", "The AI briefing has not refreshed", f"Last generated {_age(age)} ago.", "system")

    rx = s.get("receiver")
    if rx:
        if rx.get("beast_connected") and rx.get("beast_healthy") is False:
            add("warning", "receiver", "The local ADS-B receiver stopped sending",
                f"Last frame {_age(rx.get('last_frame_age_s') or 0)} ago.", "ingestion")
        elif rx.get("beast_connected") is False:
            add("info", "receiver", "No local ADS-B receiver connected",
                "Community and OpenSky feeds are covering aircraft.", "ingestion")

    issues.sort(key=lambda i: _SEVERITY_ORDER[i["severity"]])
    return issues


def overall_status(issues: list[dict]) -> str:
    """ok / warning / critical from the issues (informational ones do not count)."""
    severities = {i["severity"] for i in issues}
    return "critical" if "critical" in severities else "warning" if "warning" in severities else "ok"


# ── activity over time, and dispatch ─────────────────────────────────────────
def parse_ts(value) -> "datetime | None":
    from datetime import datetime, timezone
    if not value:
        return None
    try:
        t = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def hourly_index(t, now, hours: int = 24) -> int | None:
    """Slot for a timestamp in an hourly series: 0 is the oldest hour, hours-1 the current hour. None if outside."""
    from datetime import timezone
    now_h = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    t_h = t.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    ago = int((now_h - t_h).total_seconds() // 3600)
    return hours - 1 - ago if 0 <= ago < hours else None


def hourly_counts(times, now, hours: int = 24) -> list[int]:
    out = [0] * hours
    for t in times:
        i = hourly_index(t, now, hours)
        if i is not None:
            out[i] += 1
    return out


def pct(present: int, total: int) -> float | None:
    return round(present / total * 100, 1) if total else None


LIFE_SAFETY_SEVERITY = 5
DISPATCH_ACTIVE_WINDOW_MIN = 60


def dispatch_activity(incidents: list[dict], now, active_window_min: int = DISPATCH_ACTIVE_WINDOW_MIN) -> dict:
    """What the radio-incident extractor is producing, from the incidents feed. `status` in that feed stays
    "active" for most incidents, so "active now" is judged by when the incident was last heard instead."""
    firsts, active, located, life, newest_age = [], 0, 0, 0, None
    categories: dict[str, int] = {}
    for i in incidents:
        last = parse_ts(i.get("last_seen"))
        first = parse_ts(i.get("first_seen")) or last
        if first:
            firsts.append(first)
        if last:
            age = (now - last).total_seconds()
            if age <= active_window_min * 60:
                active += 1
            newest_age = age if newest_age is None else min(newest_age, age)
        if i.get("lat") is not None and i.get("lon") is not None:
            located += 1
        if (i.get("severity") or 0) >= LIFE_SAFETY_SEVERITY:
            life += 1
        cat = i.get("category") or "other"
        categories[cat] = categories.get(cat, 0) + 1
    top = sorted(categories.items(), key=lambda kv: -kv[1])[:5]
    return {
        "seen_24h": len(incidents), "active_now": active, "hourly": hourly_counts(firsts, now),
        "located": located, "located_pct": pct(located, len(incidents)), "life_safety": life,
        "categories": [[k, v] for k, v in top],
        "newest_age_s": None if newest_age is None else round(newest_age),
    }
