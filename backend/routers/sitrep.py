import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db, get_redis_client
from db.models import Entity, Event

router = APIRouter(prefix="/sitrep", tags=["sitrep"])


def _safe_md(text: str, max_len: int = 500) -> str:
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'\[.*?\]\(.*?\)', '', text)
    return text[:max_len]


@router.get("")
async def generate_sitrep(
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis_client),
):
    """Generate a Markdown situation report for the given time window."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=hours)

    # Entity counts by type
    type_rows = await db.execute(
        select(Entity.entity_type, func.count(Entity.entity_id))
        .group_by(Entity.entity_type)
    )
    entity_counts: dict[str, int] = {row[0]: row[1] for row in type_rows}
    total_entities = sum(entity_counts.values())

    # Recent events in window
    event_rows = await db.execute(
        select(Event)
        .where(Event.ts >= window_start)
        .order_by(Event.ts.desc())
        .limit(50)
    )
    events = event_rows.scalars().all()

    critical_events = [e for e in events if e.severity in ("critical", "high")]
    geofence_events = [e for e in events if "geofence" in e.event_type]
    p25_events      = [e for e in events if "p25" in e.event_type]
    seismic_events  = [e for e in events if "seismic" in e.event_type]

    # AI summary from Redis
    ai_summary = "No AI summary available."
    ai_model = ""
    ai_ts = ""
    try:
        raw = await redis.get("feed:summary:latest")
        if raw:
            data = json.loads(raw)
            ai_summary = data.get("summary", ai_summary)
            ai_model = data.get("model") or ""
            ai_ts = data.get("ts") or ""
    except Exception:
        pass

    # Weather alerts from Redis
    weather_alerts: list[str] = []
    try:
        raw_w = await redis.get("feed:weather:alerts")
        if raw_w:
            alerts_data = json.loads(raw_w)
            if isinstance(alerts_data, list):
                weather_alerts = [_safe_md(a.get("headline") or a.get("event", "")) for a in alerts_data[:5]]
    except Exception:
        pass

    # ── Build Markdown ─────────────────────────────────────────────────────────
    ts_fmt = now.strftime("%Y-%m-%d %H:%M UTC")
    window_label = f"{hours}h" if hours < 24 else f"{hours // 24}d"

    lines: list[str] = [
        f"# VERTEX SITUATION REPORT",
        f"",
        f"**Generated:** {ts_fmt}  ",
        f"**Window:** Last {window_label}  ",
        f"**Classification:** UNCLASSIFIED // FOR OFFICIAL USE ONLY",
        f"",
        f"---",
        f"",
        f"## 1. AI Situational Summary",
        f"",
        f"{ai_summary}",
    ]
    if ai_model:
        lines.append(f"")
        lines.append(f"*Model: {ai_model}" + (f" · {ai_ts}" if ai_ts else "") + "*")

    lines += [
        f"",
        f"---",
        f"",
        f"## 2. Tracked Entities",
        f"",
        f"| Type | Count |",
        f"|------|-------|",
    ]
    for etype, count in sorted(entity_counts.items(), key=lambda x: -x[1]):
        lines.append(f"| {etype.replace('_', ' ').title()} | {count} |")
    lines.append(f"| **Total** | **{total_entities}** |")

    lines += [
        f"",
        f"---",
        f"",
        f"## 3. Weather Alerts",
        f"",
    ]
    if weather_alerts:
        for alert in weather_alerts:
            lines.append(f"- {alert}")
    else:
        lines.append("No active weather alerts.")

    lines += [
        f"",
        f"---",
        f"",
        f"## 4. Notable Events ({len(events)} total in window)",
        f"",
    ]

    if critical_events:
        lines += [f"### Critical / High Severity ({len(critical_events)})", ""]
        for e in critical_events[:10]:
            ts = e.ts.strftime("%H:%M")
            lines.append(f"- **[{e.severity.upper()}]** `{ts}` {_safe_md(e.summary)}")
        lines.append("")

    if geofence_events:
        lines += [f"### Geofence Triggers ({len(geofence_events)})", ""]
        for e in geofence_events[:10]:
            ts = e.ts.strftime("%H:%M")
            lines.append(f"- `{ts}` {_safe_md(e.summary)}")
        lines.append("")

    if p25_events:
        lines += [f"### Radio / P25 Activity ({len(p25_events)} calls)", ""]

    if seismic_events:
        lines += [f"### Seismic Events ({len(seismic_events)})", ""]
        for e in seismic_events[:5]:
            ts = e.ts.strftime("%H:%M")
            lines.append(f"- `{ts}` {_safe_md(e.summary)}")
        lines.append("")

    if not critical_events and not geofence_events and not p25_events and not seismic_events:
        lines.append("No notable events in this window.")

    lines += [
        "",
        "---",
        "",
        f"*End of SitRep — Vertex Situational Awareness Platform*",
    ]

    md = "\n".join(lines)
    filename = f"sitrep_{now.strftime('%Y%m%d_%H%M')}.md"

    return Response(
        content=md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
