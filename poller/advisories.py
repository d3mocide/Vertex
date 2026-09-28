"""
Advisory ranking — what the top-of-app advisory bar shows.

Candidates come from every source (NWS warnings, dispatch incidents from the
radio, ODOT closures, FlashAlert agency notices) and are promoted by fixed,
explainable rules — never by a model — then ranked by severity, not counted.
The bar's level is the worst item's level:

  red    life-safety: NWS Extreme/Severe, or a nearby structure fire, water
         rescue or violent incident heard on dispatch in the last hour
  amber  notable: other NWS alerts, nearby gas leak / hazmat / rescue /
         person struck, a multi-unit response, any fire / crash / assault
         close to home or inside a zone, a nearby road closure, or a
         FlashAlert notice from a local agency
"""
from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timedelta, timezone

LEVEL_RANK = {"red": 2, "amber": 1}

CATEGORY_LABELS = {
    "water_rescue": "Water rescue",
    "structure_fire": "Structure fire",
    "violence": "Violent incident",
    "rescue": "Rescue",
    "hazmat": "Hazmat",
    "gas_leak": "Gas leak",
    "carbon_monoxide": "Carbon monoxide",
    "train_or_ped_struck": "Person struck",
    "crash": "Crash",
    "vehicle_fire": "Vehicle fire",
    "outside_fire": "Outside fire",
    "assault": "Assault",
    "fire": "Fire",
    "medical": "Medical",
}
_KM_PER_MI = 1.609344


def _id(prefix: str, *parts) -> str:
    return prefix + ":" + hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _ago(ts: datetime, now: datetime) -> str:
    minutes = max(0, int((now - ts).total_seconds() // 60))
    return "just now" if minutes < 1 else f"{minutes} min ago" if minutes < 60 else f"{minutes // 60} h ago"


# ── Sources ──────────────────────────────────────────────────────────────────

def from_nws(alerts: list[dict], now: datetime) -> list[dict]:
    out = []
    for a in alerts or []:
        expires = _parse_ts(a.get("expires"))
        if expires and expires < now:
            continue
        sev = (a.get("severity") or "").lower()
        level = "red" if sev in ("extreme", "severe") else "amber"
        score = {"extreme": 100, "severe": 90, "moderate": 60, "minor": 40}.get(sev, 30)
        event = a.get("event") or "Weather alert"
        out.append({
            "id": _id("nws", a.get("headline") or event),
            "source": "nws", "level": level, "score": score,
            "title": event, "detail": a.get("headline") or "",
            "ts": None, "why": f"NWS {sev or 'unrated'} alert",
            "target": {"tab": "incidents"},
        })
    return out


def from_radio(incidents: list[dict], now: datetime, home: tuple[float, float],
               radius_km: float, max_age: timedelta) -> list[dict]:
    out = []
    for inc in incidents or []:
        last = _parse_ts(inc.get("last_seen"))
        if last is None or now - last > max_age or inc.get("status") == "cleared":
            continue
        if inc.get("lat") is None or inc.get("lon") is None:
            continue   # a pin you can open, or it stays on the incidents list
        dist = distance_km(home[0], home[1], inc["lat"], inc["lon"])
        zones = inc.get("geofences") or []
        if dist > radius_km and not zones:
            continue
        sev = int(inc.get("severity") or 0)
        units, calls = len(inc.get("units") or []), int(inc.get("call_count") or 0)
        if sev >= 5:
            level, why = "red", "life-safety incident nearby"
        elif sev >= 4:
            level, why = "amber", "hazard nearby"
        elif sev >= 3 and (units >= 3 or calls >= 4):
            level, why = "amber", "multi-unit response nearby"
        elif sev >= 3 and (zones or dist <= radius_km / 2):
            level, why = "amber", "incident close to home" if not zones else "incident in a watched zone"
        else:
            continue
        if inc.get("status") == "contained" and level == "red":
            level = "amber"
        minutes = (now - last).total_seconds() / 60
        score = (sev * 20 + min(units, 6) * 3 + min(calls, 6) * 2
                 + (10 if zones else 0) + max(0, 10 - int(minutes / 6)))
        label = CATEGORY_LABELS.get(inc.get("category") or "", (inc.get("category") or "Incident").replace("_", " ").capitalize())
        bits = [f"{units} unit{'s' if units != 1 else ''}" if units else None,
                f"{calls} calls" if calls > 1 else None,
                f"{dist / _KM_PER_MI:.1f} mi away",
                ", ".join(zones[:2]) if zones else None,
                _ago(last, now)]
        out.append({
            "id": f"radio:{inc.get('id')}",
            "source": "radio", "level": level, "score": score,
            "title": f"{label} · {inc.get('location') or 'location not stated'}",
            "detail": " · ".join(b for b in bits if b),
            "ts": last.isoformat(), "why": why,
            "lat": inc["lat"], "lon": inc["lon"],
            "target": {"tab": "incidents", "incident": inc.get("id")},
        })
    return out


def from_traffic(items: list[dict], now: datetime, radius_km: float, max_age: timedelta) -> list[dict]:
    out = []
    for t in items or []:
        if not (t.get("severity") or "").lower().startswith("closure"):
            continue
        if t.get("dist_km") is None or float(t["dist_km"]) > radius_km:
            continue
        published = _parse_ts(t.get("pubDate"))
        if published is None or now - published > max_age:
            continue   # long-running construction closures are not advisories
        out.append({
            "id": _id("traffic", t.get("title"), t.get("location")),
            "source": "traffic", "level": "amber",
            "score": 30 + (5 if "detour" not in (t.get("severity") or "").lower() else 0),
            "title": f"Road closure · {t.get('location') or ''}".strip(" ·"),
            "detail": re.sub(r"\s+", " ", t.get("title") or "")[:140],
            "ts": published.isoformat(), "why": "road closure nearby",
            "lat": t.get("lat"), "lon": t.get("lon"),
            "target": {"tab": "incidents"},
        })
    return out


def from_flashalert(items: list[dict], places: list[str]) -> list[dict]:
    if not places:
        return []
    pat = re.compile(r"\b(" + "|".join(re.escape(p) for p in places) + r")\b", re.IGNORECASE)
    out = []
    for a in items or []:
        if a.get("source") != "flashalert":
            continue   # NWS items in the same feed are handled by from_nws
        hit = pat.search(f"{a.get('title', '')} {a.get('summary', '')}")
        if not hit:
            continue
        out.append({
            "id": _id("flash", a.get("title"), a.get("summary")),
            "source": "flashalert", "level": "amber", "score": 20,
            "title": a.get("title") or "Agency notice",
            "detail": (a.get("summary") or "")[:160],
            "ts": None, "why": f"local agency notice ({hit.group(1)})",
            "target": {"tab": "intel"},
        })
    return out


def rank(candidates: list[dict], limit: int = 10) -> dict:
    """Best first: level, then score, then most recent."""
    items = sorted(candidates, key=lambda c: (LEVEL_RANK[c["level"]], c["score"], c.get("ts") or ""), reverse=True)
    level = items[0]["level"] if items else "green"
    return {"level": level, "count": len(items), "items": items[:limit]}
