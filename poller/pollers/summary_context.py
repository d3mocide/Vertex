"""
Context assembly for the AI situational briefing.

Collects the last N hours of Vertex data (Redis feeds + PostgreSQL history)
into a compact, dated, distance-banded text block for the summary LLM.
Every item carries a timestamp and — where the data has a location — a
distance from the region centre, so the model can triage by relevance
instead of guessing.

Formatting helpers are pure functions so they can be unit-tested without
Redis or a database.
"""
import json
import logging
import math
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from config import settings

logger = logging.getLogger(__name__)

_INJECTION_PATTERNS = ('###', 'SYSTEM:', '<|', '[INST]', '<<SYS>>')


def sanitise(text, max_len: int = 300) -> str:
    """Strip prompt-injection markers, collapse whitespace, and truncate."""
    text = str(text or "")
    text = re.sub(r'<!--.*?-->', ' ', text, flags=re.S)
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)   # [label](url) -> label
    text = re.sub(r'<[^>]+>', ' ', text)
    for pat in _INJECTION_PATTERNS:
        text = text.replace(pat, '')
    text = re.sub(r'\s+', ' ', text).strip()
    if len(text) > max_len:
        text = text[:max_len].rstrip() + "…"
    return text


def region_tz():
    try:
        return ZoneInfo(settings.region_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def parse_ts(value) -> datetime | None:
    """Parse ISO-8601, RFC-822 (RSS) or epoch values into an aware UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        # Accept seconds or milliseconds since epoch.
        secs = value / 1000 if value > 1e11 else value
        try:
            dt = datetime.fromtimestamp(secs, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    else:
        text = str(value).strip()
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt = parsedate_to_datetime(text)
            except (TypeError, ValueError, IndexError):
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def fmt_ts(value, now: datetime) -> str:
    """Render a timestamp as local time plus age, e.g. 'Thu 14:05 (3h ago)'."""
    dt = parse_ts(value)
    if dt is None:
        return "time unknown"
    local = dt.astimezone(region_tz())
    age = now - dt
    mins = int(age.total_seconds() // 60)
    if mins < 0:
        rel = f"in {-mins // 60}h" if mins <= -60 else f"in {-mins}m"
    elif mins < 60:
        rel = f"{mins}m ago"
    elif mins < 48 * 60:
        rel = f"{mins // 60}h ago"
    else:
        rel = f"{mins // 1440}d ago"
    return f"{local.strftime('%a %H:%M')} ({rel})"


def haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def distance_band(dist_km) -> str:
    """LOCAL = inside the fire alert radius; REGIONAL = inside the watch radius."""
    if not isinstance(dist_km, (int, float)):
        return "UNLOCATED"
    if dist_km <= settings.fire_alert_radius_km:
        return "LOCAL"
    if dist_km <= settings.fire_regional_radius_km:
        return "REGIONAL"
    return "DISTANT"


def _loads(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


# ── Section builders (pure) ──────────────────────────────────────────────────

def format_header(now: datetime, window_hours: int, previous_ts: str | None) -> str:
    local = now.astimezone(region_tz())
    lines = [
        "BRIEFING PARAMETERS:",
        f"- Region: {settings.region_name} (centre {settings.region_lat:.4f}, {settings.region_lon:.4f}; "
        f"operating box lat {settings.bbox_min_lat}–{settings.bbox_max_lat}, lon {settings.bbox_min_lon}–{settings.bbox_max_lon})",
        f"- Current time: {local.strftime('%A %Y-%m-%d %H:%M %Z')}",
        f"- Reporting window: last {window_hours} hours",
        f"- Distance bands (from region centre): LOCAL ≤ {settings.fire_alert_radius_km} km, "
        f"REGIONAL ≤ {settings.fire_regional_radius_km} km, DISTANT beyond that",
    ]
    if previous_ts:
        lines.append(f"- Previous briefing issued: {fmt_ts(previous_ts, now)}")
    else:
        lines.append("- Previous briefing: none on record (first briefing)")
    return "\n".join(lines)


def format_current_weather(wx: dict | None, now: datetime) -> str:
    if not isinstance(wx, dict) or not wx:
        return "CURRENT CONDITIONS: Observation feed unavailable."
    parts = []
    if wx.get("condition"):
        parts.append(sanitise(wx["condition"], 60))
    if wx.get("temp_f") is not None:
        parts.append(f"{wx['temp_f']}°F")
    if wx.get("wind_mph") is not None:
        wind = f"wind {wx.get('wind_dir') or ''} {wx['wind_mph']} mph".replace("  ", " ")
        if wx.get("wind_gust_mph") is not None:
            wind += f" gusting {wx['wind_gust_mph']} mph"
        parts.append(wind)
    if wx.get("humidity"):
        parts.append(f"RH {wx['humidity']}%")
    if wx.get("aqi") is not None:
        parts.append(f"AQI {wx['aqi']} ({wx.get('aqi_label') or 'unknown'})")
    station = wx.get("station", "")
    station = station.rsplit("/", 1)[-1] if isinstance(station, str) else ""
    when = fmt_ts(wx.get("timestamp"), now) if wx.get("timestamp") else "time unknown"
    return f"CURRENT CONDITIONS ({station or 'primary station'}, observed {when}):\n- " + ", ".join(parts)


def format_weather_alerts(alerts, now: datetime) -> str:
    if alerts is None:
        return "NWS ALERTS: Feed unavailable."
    if not alerts:
        return "NWS ALERTS: None active for the configured zones."
    lines = []
    for a in alerts[:10]:
        head = sanitise(a.get("event"), 80)
        sev = "/".join(x for x in (a.get("severity"), a.get("urgency"), a.get("certainty")) if x)
        area = sanitise(a.get("area_desc") or a.get("areaDesc"), 120)
        timing = f"effective {fmt_ts(a.get('effective') or a.get('onset'), now)}, expires {fmt_ts(a.get('expires'), now)}"
        desc = sanitise(a.get("description") or a.get("headline"), 350)
        lines.append(f"- {head} [{sev or 'severity n/a'}] — {area or 'area n/a'}; {timing}\n  {desc}")
    return "NWS ALERTS (active):\n" + "\n".join(lines)


_AFD_KEEP = re.compile(r'^\.(KEY MESSAGES|SYNOPSIS|WHAT HAS CHANGED|SHORT TERM|DISCUSSION)', re.I | re.M)


def extract_afd(text: str, max_len: int = 2000) -> str:
    """Pull the forecaster's key-message / synopsis section out of an AFD."""
    if not text:
        return ""
    m = _AFD_KEEP.search(text)
    body = text[m.start():] if m else text
    # Stop at the next major section after the one we kept.
    nxt = re.search(r'\n\.(LONG TERM|AVIATION|MARINE|FIRE WEATHER|HYDROLOGY|[A-Z]{3} WATCHES)', body[1:])
    if nxt:
        body = body[: nxt.start() + 1]
    body = body.replace("&&", "")
    return sanitise(body, max_len)


def format_nws_products(products, now: datetime, window_start: datetime) -> str | None:
    if not isinstance(products, list) or not products:
        return None
    lines = []
    for p in products:
        code = p.get("code")
        issued = parse_ts(p.get("issuance_time"))
        text = p.get("text") or ""
        if code == "CF6" or not text:
            continue
        if code == "LSR" and (issued is None or issued < window_start):
            continue  # storm reports only matter inside the window
        if code == "AFD":
            body = extract_afd(text)
        elif code == "HWO":
            body = sanitise(text, 1000)
        else:
            body = sanitise(text, 900)
        lines.append(f"- {p.get('name', code)} (issued {fmt_ts(p.get('issuance_time'), now)}):\n  {body}")
    if not lines:
        return None
    return "NWS FORECASTER PRODUCTS (use for the outlook / next-24h section):\n" + "\n".join(lines)


def format_fire_incidents(entities: list[dict], now: datetime) -> str:
    if not entities:
        return "WILDFIRE INCIDENTS: None inside the local alert or regional watch radius."
    entities = sorted(entities, key=lambda e: e.get("distance_km") if isinstance(e.get("distance_km"), (int, float)) else 1e9)
    lines = []
    for ent in entities[:10]:
        name = sanitise(ent.get("display_name") or "Wildfire", 120)
        dist = ent.get("distance_km")
        dist_text = f"{round(dist)} km" if isinstance(dist, (int, float)) else "distance unknown"
        lines.append(f"- [{distance_band(dist)}] {name} — {dist_text}, last update {fmt_ts(ent.get('last_seen'), now)}")
    return "WILDFIRE INCIDENTS (EONET, nearest first):\n" + "\n".join(lines)


def format_fire_perimeters(payload, now: datetime) -> str:
    if payload is None:
        return "MAPPED FIRE PERIMETERS (NIFC): Feed has not synced."
    fires = payload.get("features", []) if isinstance(payload, dict) else (payload or [])
    if not fires:
        return "MAPPED FIRE PERIMETERS (NIFC): None in the regional query area."
    # NIFC keeps small, long-dead perimeters around for months; only recently
    # updated ones say anything about current fire activity.
    stale_before = now - timedelta(hours=settings.fire_regional_recent_hours)
    rows = []
    stale = 0
    for f in fires:
        props = f.get("properties", {}) if isinstance(f, dict) else {}
        updated = parse_ts(props.get("updated"))
        if updated is None or updated < stale_before:
            stale += 1
            continue
        clat, clon = props.get("centroid_lat"), props.get("centroid_lon")
        dist = haversine_km(settings.region_lat, settings.region_lon, clat, clon) \
            if isinstance(clat, (int, float)) and isinstance(clon, (int, float)) else None
        rows.append((dist, props))
    rows.sort(key=lambda r: r[0] if r[0] is not None else 1e9)
    stale_note = f" ({stale} older/undated perimeters omitted as inactive)" if stale else ""
    if not rows:
        return f"MAPPED FIRE PERIMETERS (NIFC): None updated in the last {settings.fire_regional_recent_hours // 24} days{stale_note}."
    lines = []
    for dist, props in rows[:10]:
        acres = props.get("acres")
        contained = props.get("contained_pct")
        bits = [f"{acres} ac" if acres is not None else "acreage unknown"]
        if contained is not None:
            bits.append(f"{contained}% contained")
        dist_text = f"{round(dist)} km" if dist is not None else "distance unknown"
        lines.append(
            f"- [{distance_band(dist)}] {sanitise(props.get('name') or 'Wildfire', 80)} "
            f"({props.get('state') or '?'}) — {dist_text}, {', '.join(bits)}, updated {fmt_ts(props.get('updated'), now)}"
        )
    return f"MAPPED FIRE PERIMETERS (NIFC, nearest first){stale_note}:\n" + "\n".join(lines)


_LOW_IMPACT = ("no to minimum delay", "informational only", "no impact")
_DISRUPTION = re.compile(r"closed|closure|crash|collision|hazard|blocked|disabled|fire|flood|debris|delay", re.I)


def is_active_disruption(inc: dict, window_start: datetime) -> bool:
    """True for incidents that currently disrupt travel, as opposed to routine/planned roadwork."""
    sev = str(inc.get("severity") or "").lower()
    text = f"{inc.get('title', '')} {inc.get('severity', '')}"
    if "closure" in sev or ("delay" in sev and not any(k in sev for k in _LOW_IMPACT)):
        return True
    updated = parse_ts(inc.get("pubDate"))
    recent = updated is not None and updated >= window_start
    return recent and not any(k in sev for k in _LOW_IMPACT) and bool(_DISRUPTION.search(text))


def format_traffic(incidents, now: datetime, window_start: datetime) -> str:
    if incidents is None:
        return "TRAFFIC: Feed unavailable."
    if not incidents:
        return "TRAFFIC: No active incidents in the operating box."
    seen: set[tuple] = set()
    active, planned = [], []
    for i in incidents:
        key = (sanitise(i.get("title"), 80), sanitise(i.get("location"), 80))
        if key in seen:
            continue
        seen.add(key)
        (active if is_active_disruption(i, window_start) else planned).append(i)

    def line(i: dict, desc_len: int) -> str:
        dist = i.get("dist_km")
        dist_text = f"{dist:.0f} km" if isinstance(dist, (int, float)) else "? km"
        loc = sanitise(i.get("location"), 120)
        desc = sanitise(i.get("description"), desc_len)
        detail = f"; {desc}" if desc and desc != loc else ""
        return (f"- {sanitise(i.get('title'), 90)} [{sanitise(i.get('severity'), 40) or 'impact n/a'}] {loc} — "
                f"{dist_text} from centre, updated {fmt_ts(i.get('pubDate'), now)}{detail}")

    out = [f"TRAFFIC — ACTIVE DISRUPTIONS ({len(active)}, nearest first):"]
    out += [line(i, 200) for i in active[:12]] or ["- None."]
    if planned:
        routes = sorted({sanitise(i.get("location"), 60).split(" - ")[0] for i in planned if i.get("location")})
        out.append(
            f"TRAFFIC — PLANNED / LONG-RUNNING ROADWORK: {len(planned)} low-impact items "
            f"(routes: {', '.join(routes[:15])}). Background only — mention solely if it compounds another event."
        )
    return "\n".join(out)


def format_utilities(oregon, pge) -> str:
    if not oregon and not pge:
        return "POWER: Outage feed unavailable."
    lines = []
    if isinstance(oregon, dict):
        lines.append(
            f"- Oregon statewide: {oregon.get('state_affected', 0)} customers out; "
            f"metro area: {oregon.get('metro_affected', 0)}; "
            f"PGE {oregon.get('pge_affected', 0)}, Pacificorp {oregon.get('pacificorp_affected', 0)} "
            f"({oregon.get('utility_count', 0)} utilities reporting)"
        )
    elif isinstance(pge, dict):
        lines.append(f"- PGE: {pge.get('customers_affected', 0)} customers out")
    return "POWER OUTAGES (current snapshot, raw counts):\n" + "\n".join(lines)


def _in_window(item: dict, window_start: datetime, key: str = "published") -> bool:
    dt = parse_ts(item.get(key))
    return dt is None or dt >= window_start


def format_flash_alerts(items, now: datetime, window_start: datetime) -> str | None:
    if not isinstance(items, list):
        return None
    recent = [i for i in items if _in_window(i, window_start)]
    if not recent:
        return "AGENCY ALERTS (FlashAlert / county EM): None issued in the window."
    lines = [
        f"- {fmt_ts(i.get('published'), now)} [{sanitise(i.get('source'), 40)}] {sanitise(i.get('title'), 140)}"
        + (f" — {sanitise(i.get('summary'), 200)}" if i.get("summary") else "")
        for i in recent[:12]
    ]
    return "AGENCY ALERTS (FlashAlert / county EM):\n" + "\n".join(lines)


def format_news(news, intel, now: datetime, window_start: datetime) -> str | None:
    """Merge news + keyword-flagged intel, dedupe by title, keep the window."""
    if not news and not intel:
        return None
    flagged = {sanitise(i.get("title"), 200).lower() for i in (intel or [])}
    seen: set[str] = set()
    rows = []
    for item in (intel or []) + (news or []):
        title = sanitise(item.get("title"), 160)
        key = title.lower()
        if not title or key in seen or not _in_window(item, window_start):
            continue
        seen.add(key)
        rows.append((parse_ts(item.get("published")), key in flagged, item, title))
    if not rows:
        return "NEWS: No items published in the window."
    rows.sort(key=lambda r: r[0] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    lines = []
    for dt, is_flagged, item, title in rows[:20]:
        flag = " [KEYWORD-FLAGGED]" if is_flagged else ""
        summary = sanitise(item.get("summary"), 180)
        lines.append(
            f"- {fmt_ts(dt, now)} [{sanitise(item.get('source'), 40)}]{flag} {title}"
            + (f" — {summary}" if summary and summary.lower() != title.lower() else "")
        )
    return (
        "NEWS (newest first; KEYWORD-FLAGGED means an automatic keyword match, not a verified priority — judge relevance yourself):\n"
        + "\n".join(lines)
    )


def event_distance_km(details) -> float | None:
    if isinstance(details, str):
        details = _loads(details)
    if not isinstance(details, dict):
        return None
    lat, lon = details.get("lat"), details.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        return haversine_km(settings.region_lat, settings.region_lon, lat, lon)
    dist = details.get("dist_km")
    return dist if isinstance(dist, (int, float)) else None


def _minor_quake(details, band: str) -> bool:
    """Quakes too small to matter at their distance (felt reports start ~M2.5 locally)."""
    if isinstance(details, str):
        details = _loads(details)
    mag = details.get("magnitude") if isinstance(details, dict) else None
    if not isinstance(mag, (int, float)):
        return False
    return mag < (2.5 if band == "LOCAL" else 4.5)


_ANOMALY_RE = re.compile(r"^(?P<metric>[\w ]+?) count (?P<dir>spike|drop)", re.I)


def format_event_activity(counts, prior_counts, recent, now: datetime) -> str:
    """Summarise DB events: per-type counts vs the prior window, anomaly roll-up, notable items.

    `recent` rows are (ts, event_type, severity, summary, details) newest first.
    """
    if not counts and not recent:
        return "SYSTEM EVENTS: None recorded in the window."
    by_type: dict[str, dict[str, int]] = {}
    for etype, sev, n in counts:
        by_type.setdefault(etype, {})[sev or "info"] = n
    prior = {etype: n for etype, n in prior_counts}
    lines = []
    for etype in sorted(by_type, key=lambda t: -sum(by_type[t].values())):
        total = sum(by_type[etype].values())
        sev_text = ", ".join(f"{s} {n}" for s, n in sorted(by_type[etype].items(), key=lambda x: -x[1]))
        lines.append(f"- {etype}: {total} ({sev_text}); prior window {prior.get(etype, 0)}")
    out = "SYSTEM EVENT ACTIVITY (count this window; 'prior window' = the equivalent period before it):\n" + "\n".join(lines)

    # Statistical count anomalies fire constantly — roll them up per metric.
    anomalies: dict[str, dict[str, int]] = {}
    notable, distant = [], 0
    rank = {"critical": 0, "high": 1, "warning": 2, "med": 2, "medium": 2}
    for ts, etype, sev, summary, details in recent:
        if etype == "anomaly":
            m = _ANOMALY_RE.match(summary or "")
            metric, direction = (m.group("metric").strip(), m.group("dir").lower()) if m else ("other", "event")
            anomalies.setdefault(metric, {}).setdefault(direction, 0)
            anomalies[metric][direction] += 1
            continue
        if etype.startswith("geofence"):
            continue  # counted above; individual crossings are routine
        dist = event_distance_km(details)
        band = distance_band(dist)
        if band == "DISTANT" or (etype == "seismic" and _minor_quake(details, band)):
            distant += 1
            continue
        where = f"{band}, {round(dist)} km" if dist is not None else band
        notable.append((rank.get(str(sev).lower(), 3), ts, etype, sev, summary, where))

    if anomalies:
        roll = [f"- {metric}: " + ", ".join(f"{n} {d}{'s' if n != 1 else ''}" for d, n in dirs.items())
                for metric, dirs in sorted(anomalies.items(), key=lambda x: -sum(x[1].values()))]
        out += ("\n\nSTATISTICAL COUNT ANOMALIES (automatic >2.5σ deviations in how many entities are tracked; "
                "usually reception/coverage noise unless they line up with a real event):\n" + "\n".join(roll))

    notable.sort(key=lambda n: (n[0], -n[1].timestamp() if isinstance(n[1], datetime) else 0))
    if notable:
        items = [f"- {fmt_ts(ts, now)} [{etype} / {sev} / {where}] {sanitise(summary, 200)}"
                 for _, ts, etype, sev, summary, where in notable[:15]]
        out += "\n\nNOTABLE SYSTEM EVENTS (within the regional radius, highest severity first):\n" + "\n".join(items)
    if distant:
        out += f"\n({distant} distant or minor seismic/disaster events omitted: beyond the regional radius, or below M2.5 local / M4.5 regional.)"
    return out


def format_radio(talkgroups, transcripts, now: datetime) -> str | None:
    if not talkgroups and not transcripts:
        return None
    parts = []
    if talkgroups:
        tg = [f"- {sanitise(tag, 60) or 'untagged'} (TGID {tgid}): {n} calls" for tag, tgid, n in talkgroups]
        parts.append("P25 RADIO — busiest talkgroups this window:\n" + "\n".join(tg))
    if transcripts:
        tr = [
            f"- {fmt_ts(ts, now)} [{sanitise(tag, 50) or tgid}] \"{sanitise(text, 220)}\""
            for ts, tgid, tag, text in transcripts
        ]
        parts.append(
            "P25 RADIO TRANSCRIPTS (automatic speech recognition — expect errors; corroborate before relying on them):\n"
            + "\n".join(tr)
        )
    return "\n\n".join(parts)


def format_entity_activity(rows) -> str | None:
    if not rows:
        return None
    lines = [f"- {etype.replace('_', ' ')}: {seen} seen in window, {active} active in last 15 min"
             for etype, seen, active in rows]
    return "TRACKED ENTITY ACTIVITY:\n" + "\n".join(lines)


def format_previous(previous: dict | None, now: datetime) -> str | None:
    if not previous or not previous.get("summary"):
        return None
    return (
        f"PREVIOUS BRIEFING (issued {fmt_ts(previous.get('ts'), now)}) — compare against it; do not copy it:\n"
        + sanitise(previous["summary"], 3000)
    )


# ── Data collection (I/O) ────────────────────────────────────────────────────

async def _db_sections(pool, now: datetime, window_start: datetime) -> list[str]:
    sections: list[str] = []
    prior_start = window_start - (now - window_start)

    try:
        counts = await pool.fetch(
            "SELECT event_type, severity, count(*) FROM events "
            "WHERE ts >= $1 AND event_type NOT LIKE 'p25%' GROUP BY 1, 2",
            window_start,
        )
        prior = await pool.fetch(
            "SELECT event_type, count(*) FROM events "
            "WHERE ts >= $1 AND ts < $2 AND event_type NOT LIKE 'p25%' GROUP BY 1",
            prior_start, window_start,
        )
        recent = await pool.fetch(
            "SELECT ts, event_type, severity, summary, details FROM events "
            "WHERE ts >= $1 AND event_type NOT LIKE 'p25%' AND event_type NOT LIKE 'geofence%' "
            "ORDER BY ts DESC LIMIT 500",
            window_start,
        )
        sections.append(format_event_activity(
            [tuple(r) for r in counts], [tuple(r) for r in prior], [tuple(r) for r in recent], now,
        ))
    except Exception as exc:
        logger.warning("[summary] event history query failed: %s", exc)
        sections.append("SYSTEM EVENTS: History unavailable (database query failed).")

    talkgroups, transcripts = [], []
    try:
        talkgroups = [tuple(r) for r in await pool.fetch(
            "SELECT details->>'tag', details->>'tgid', count(*) FROM events "
            "WHERE ts >= $1 AND event_type = 'p25_call_start' "
            "GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8",
            window_start,
        )]
    except Exception as exc:
        logger.debug("[summary] talkgroup query failed: %s", exc)
    try:
        transcripts = [tuple(r) for r in await pool.fetch(
            "SELECT started_at, tgid, tag, transcription FROM p25_recordings "
            "WHERE started_at >= $1 AND length(coalesce(transcription, '')) >= 25 "
            "ORDER BY started_at DESC LIMIT $2",
            window_start, settings.summary_max_transcripts,
        )]
    except Exception as exc:
        # p25_recordings is created by the backend; absent on radio-less installs.
        logger.debug("[summary] transcript query failed: %s", exc)
    radio = format_radio(talkgroups, transcripts, now)
    if radio:
        sections.append(radio)

    try:
        rows = await pool.fetch(
            "SELECT entity_type, count(*) FILTER (WHERE last_seen >= $1), "
            "count(*) FILTER (WHERE last_seen >= $2) FROM entities "
            "WHERE last_seen >= $1 GROUP BY 1 ORDER BY 2 DESC",
            window_start, now - timedelta(minutes=15),
        )
        entity = format_entity_activity([tuple(r) for r in rows])
        if entity:
            sections.append(entity)
    except Exception as exc:
        logger.debug("[summary] entity activity query failed: %s", exc)

    return sections


_TRIM_MARK = "- (remaining items trimmed to fit the model's context window)"


def fit_budget(sections: list[tuple[int, str]], budget: int) -> list[str]:
    """Trim sections to fit a character budget, lowest priority first.

    `sections` are (priority, text) in display order; higher priority survives
    longer. Trimming drops trailing lines of the lowest-priority section, then
    removes it entirely once only its heading is left.
    """
    items = [[prio, text.split("\n")] for prio, text in sections]

    def size() -> int:
        return sum(len("\n".join(lines)) + 2 for _, lines in items)

    while size() > budget and items:
        victim = min((i for i in items if i[0] < 100), key=lambda i: i[0], default=None)
        if victim is None:
            break  # only must-keep sections left
        lines = victim[1]
        has_marker = lines[-1] == _TRIM_MARK
        content = len(lines) - (1 if has_marker else 0)
        if content > 1:
            del lines[content - 1]
            if not has_marker:
                lines.append(_TRIM_MARK)
        else:
            items.remove(victim)
    return ["\n".join(lines) for _, lines in items]


# Section priorities for fit_budget — 100+ is never trimmed.
_P_KEEP, _P_HIGH, _P_MED, _P_LOW = 100, 60, 40, 20


async def build_context(r, pool, now: datetime, window_hours: int, previous: dict | None) -> tuple[str, list[str]]:
    """Return (context_text, data_gaps). `pool` may be None if the DB is down."""
    window_start = now - timedelta(hours=window_hours)
    sections: list[tuple[int, str]] = [(_P_KEEP, format_header(now, window_hours, previous.get("ts") if previous else None))]

    wx = _loads(await r.get("feed:weather:current"))
    sections.append((_P_KEEP, format_current_weather(wx, now)))
    alerts = _loads(await r.get("feed:weather:alerts"))
    sections.append((_P_KEEP, format_weather_alerts(alerts, now)))
    products = format_nws_products(_loads(await r.get("feed:weather:nwws_products")), now, window_start)
    if products:
        sections.append((_P_MED, products))

    fire_entities: list[dict] = []
    for key in await r.keys("entity:fire:*"):
        ent = _loads(await r.get(key))
        if isinstance(ent, dict):
            fire_entities.append(ent)
    sections.append((_P_HIGH, format_fire_incidents(fire_entities, now)))
    sections.append((_P_HIGH, format_fire_perimeters(_loads(await r.get("feed:fire:perimeters")), now)))

    traffic = _loads(await r.get("feed:traffic:incidents"))
    sections.append((_P_HIGH + 5, format_traffic(traffic, now, window_start)))

    oregon = _loads(await r.get("feed:utility:oregon"))
    pge = _loads(await r.get("feed:utility:pge"))
    sections.append((_P_KEEP, format_utilities(oregon, pge)))

    flash = format_flash_alerts(_loads(await r.get("feed:alerts:flash")), now, window_start)
    if flash:
        sections.append((_P_HIGH + 10, flash))

    if pool is not None:
        db_sections = await _db_sections(pool, now, window_start)
        for text in db_sections:
            if text.startswith("P25 RADIO"):
                # Split so transcripts (large, noisy) trim before talkgroup counts.
                head, sep, transcripts = text.partition("\n\nP25 RADIO TRANSCRIPTS")
                sections.append((_P_MED + 5, head))
                if sep:
                    sections.append((_P_LOW + 10, "P25 RADIO TRANSCRIPTS" + transcripts))
            elif text.startswith("TRACKED ENTITY"):
                sections.append((_P_LOW + 5, text))
            else:
                sections.append((_P_HIGH, text))
    else:
        sections.append((_P_KEEP, "SYSTEM EVENTS: Database unavailable — no event, radio or entity history."))

    news = format_news(
        _loads(await r.get("feed:news:local")), _loads(await r.get("feed:intel:alerts")), now, window_start,
    )
    if news:
        sections.append((_P_LOW, news))

    prev = format_previous(previous, now)
    if prev:
        sections.append((_P_MED, prev))

    texts = fit_budget(sections, settings.summary_context_max_chars)
    gaps = [t.split("\n", 1)[0] for t in texts
            if "unavailable" in t.split("\n", 1)[0].lower() or "not synced" in t.split("\n", 1)[0].lower()]
    return "\n\n".join(texts), gaps
