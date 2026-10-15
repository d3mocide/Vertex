"""NOAA Weather Radio alerts from Tocsin, mapped onto Vertex's weather-alert shape.

Tocsin decodes the SAME header off the NWR broadcast and fuses it with NWS CAP. These helpers turn its alert
records into the dicts the Environment page already renders for CAP alerts, keep only the ones for the
operator's zones, and merge them with the CAP list (a CAP alert that RF also announced is marked, not doubled).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

# SAME location codes are PSSCCC (part, state FIPS, county FIPS); NWS zone codes are SSC### (state letters,
# "C" for county, county FIPS). Only the states a deployment can plausibly cover are listed; an unknown state
# simply never matches a zone filter.
_STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
    "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
    "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
    "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
    "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
    "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
}

# Tocsin's dispatch tiers: A immediate-threat warnings, B watches and advisories, C tests and routine programming.
_SEVERITY_BY_TIER = {"A": "Severe", "B": "Moderate", "C": "Minor"}

# Tocsin's fusion states, in the words an operator reads.
STATE_LABELS = {
    "RF_ONLY": "Heard on NWR, not yet in the NWS feed",
    "CONFIRMED": "Heard on NWR and confirmed by NWS",
    "API_ONLY": "In the NWS feed, not heard on NWR",
    "TRANSCRIPT_ONLY": "Spoken on NWR audio only (keyword match, no SAME header)",
}


def fips_to_ugc(fips: str) -> str | None:
    """041067 -> ORC067. Returns None for codes that name no single county (statewide 000, malformed)."""
    code = str(fips or "").strip()
    if len(code) != 6 or not code.isdigit() or code[3:] == "000":
        return None
    state = _STATE_FIPS.get(code[1:3])
    return f"{state}C{code[3:]}" if state else None


def _parse_time(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _rf_event(alert: dict) -> dict:
    for src in alert.get("sources") or []:
        if src.get("kind") == "RF" and isinstance(src.get("event"), dict):
            return src["event"]
    return {}


def zone_set(zones: str) -> set[str]:
    return {z.strip().upper() for z in (zones or "").split(",") if z.strip()}


def is_relevant(alert: dict, zones: set[str]) -> bool:
    """True when no zone filter is set, or the alert names a county (or a statewide area) in the filter."""
    if not zones:
        return True
    states = {z[:2] for z in zones}
    for code in alert.get("fips_codes") or []:
        code = str(code)
        ugc = fips_to_ugc(code)
        if ugc and ugc in zones:
            return True
        if code[3:] == "000" and _STATE_FIPS.get(code[1:3]) in states:
            return True
    # A zone filter made only of forecast zones (ORZ108...) cannot be matched to a county code exactly; a TRANSCRIPT_ONLY
    # alert carries no codes at all. Neither is dropped silently: with no county to compare, keep it.
    if not any(z[2:3] == "C" for z in zones):
        return True
    return not (alert.get("fips_codes") or [])


def normalize(alert: dict, now: datetime | None = None, transcript: str = "") -> dict | None:
    """One Tocsin alert as a Vertex weather alert, or None once it has expired."""
    now = now or datetime.now(timezone.utc)
    rf = _rf_event(alert)
    started = _parse_time(rf.get("received_at")) or _parse_time(alert.get("first_seen")) or now
    purge = rf.get("purge_minutes")
    expires = started + timedelta(minutes=int(purge)) if isinstance(purge, (int, float)) and purge > 0 else None
    if expires is None:
        for src in alert.get("sources") or []:
            expires = _parse_time((src.get("alert") or {}).get("ends")) or expires
    if expires is not None and expires <= now:
        return None
    event = alert.get("event_name") or rf.get("event_name") or "NOAA Weather Radio alert"
    state = alert.get("state") or ""
    callsign = rf.get("callsign") or ""
    headline = f"{event} via NOAA Weather Radio" + (f" ({callsign})" if callsign else "")
    return {
        "event": event,
        "headline": headline,
        "description": transcript.strip(),
        "severity": _SEVERITY_BY_TIER.get(str(rf.get("tier") or "").upper(), "Unknown"),
        "expires": expires.isoformat() if expires else "",
        "source": "nwr",
        "nwr_id": alert.get("id") or "",
        "nwr_state": state,
        "nwr_state_label": STATE_LABELS.get(state, state),
        "nwr_channel": rf.get("channel") or "",
        "nwr_counties": [u for u in (fips_to_ugc(c) for c in alert.get("fips_codes") or []) if u],
        "received_at": started.isoformat(),
        "test": str(rf.get("event_code") or "").upper() in {"RWT", "RMT", "NPT", "DMO"},
    }


def recent_spoken(transcripts: list[dict], limit: int = 8) -> list[dict]:
    """The newest continuous-broadcast chunks Tocsin transcribed (about 20 s each), newest first, as the card shows
    them. Alert-audio transcripts and chunks that failed Tocsin's guard (its hallucination filter) are skipped."""
    out = []
    for t in sorted(transcripts, key=lambda t: t.get("timestamp_ns") or 0, reverse=True):
        text = str(t.get("text") or "").strip()
        if str(t.get("event_code")) != "LIVE" or not t.get("passed_guard", True) or not text or not t.get("timestamp_ns"):
            continue
        out.append({"text": text, "channel": t.get("channel"),
                    "at": datetime.fromtimestamp(t["timestamp_ns"] / 1e9, timezone.utc).isoformat()})
        if len(out) >= limit:
            break
    return out


def merge(cap_alerts: list[dict], nwr: list[dict]) -> list[dict]:
    """CAP alerts first; an NWR alert whose event CAP already lists marks that CAP alert as RF-heard instead of
    appearing twice. Tests are kept but sort last."""
    merged = [dict(a) for a in cap_alerts if a.get("source") != "nwr"]
    by_event = {str(a.get("event", "")).lower(): a for a in merged}
    extra = []
    for n in nwr:
        twin = by_event.get(str(n.get("event", "")).lower())
        if twin is not None:
            twin["rf_heard"] = True
            twin["received_at"] = twin.get("received_at") or n.get("received_at")
        else:
            extra.append(n)
    extra.sort(key=lambda a: a.get("received_at", ""), reverse=True)      # newest first,
    extra.sort(key=lambda a: bool(a.get("test")))                          # then tests last (stable)
    return merged + extra


# An alert the NWS feed already lists is drawn by the map's NWS alerts layer; only RF-first ones need an outline
# of their own (and tests never do).
_OUTLINE_STATES = {"RF_ONLY", "TRANSCRIPT_ONLY"}


def outline_ugcs(alerts: list[dict]) -> set[str]:
    return {u for a in alerts if _wants_outline(a) for u in a.get("nwr_counties", [])}


def _wants_outline(alert: dict) -> bool:
    return alert.get("nwr_state") in _OUTLINE_STATES and not alert.get("test")


def build_areas(alerts: list[dict], geometries: dict[str, dict | None]) -> list[dict]:
    """One outline per (alert, county) with a known shape: what the map draws for RF-first alerts."""
    out = []
    for a in alerts:
        if not _wants_outline(a):
            continue
        for ugc in a.get("nwr_counties", []):
            geometry = geometries.get(ugc)
            if geometry:
                out.append({
                    "ugc": ugc, "event": a.get("event", ""), "severity": a.get("severity", ""),
                    "expires": a.get("expires", ""), "alert_id": a.get("nwr_id", ""), "geometry": geometry,
                })
    return out


def round_geometry(geometry: dict, places: int = 4) -> dict:
    """Round coordinates (~10 m at 4 places) so a county outline stays a few KB in Redis and over the wire."""
    def walk(node):
        if isinstance(node, (int, float)):
            return round(node, places)
        return [walk(n) for n in node]
    return {"type": geometry.get("type"), "coordinates": walk(geometry.get("coordinates", []))}
