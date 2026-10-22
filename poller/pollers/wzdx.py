"""Road work from any US DOT Work Zone Data Exchange (WZDx) GeoJSON feed, described by a region pack's manifest.

WZDx is the federal open standard many state DOTs publish; the pack names the feed address, an optional key and the
agency, and nothing from the pack is executed. Work zones become ``traffic.incidents`` items like any other provider's,
so they sort, group and map with the existing incident views (planned work, never marked as an unplanned event).
"""
import logging
import math
import os
from datetime import datetime, timedelta, timezone

import httpx

from arcgis import read_json
from bus import set_feed
from config import settings
from normalizers.beast_math import haversine_km
from .base import BasePoller
from .traffic import _clean, triage_incidents
from .wsdot import _iso

logger = logging.getLogger(__name__)

_SOON = timedelta(hours=24)         # work scheduled further ahead is not an incident today
_MAX_VERTICES = 5000
_MAX_ITEMS = 500
_IMPACT = {"all-lanes-closed": "Closure: all lanes closed", "some-lanes-closed": "Some lanes closed",
           "alternating-one-way": "Alternating one-way traffic", "all-lanes-open": "",
           "some-lanes-closed-merge-left": "Some lanes closed", "some-lanes-closed-merge-right": "Some lanes closed",
           "all-lanes-open-shift-left": "", "all-lanes-open-shift-right": "", "unknown": ""}


def _affects_traffic(p):
    """Whether a work zone is news. The agency's own impact wins: lanes closed or alternating traffic is listed, "all
    lanes open" never is, and a zone that does not say is listed only once it is flagged active (a long contract that
    is merely scheduled would otherwise flood the incident list)."""
    impact = str(p.get("vehicle_impact") or "").lower()
    if impact in ("", "unknown"):
        return str(p.get("event_status") or "").lower() == "active"
    return _IMPACT.get(impact, "Traffic affected") != ""


def _vertices(geometry):
    """Every [lon, lat] of a Point, MultiPoint, LineString or MultiLineString geometry (bounded)."""
    if not isinstance(geometry, dict):
        return []
    kind, coords = geometry.get("type"), geometry.get("coordinates")
    if kind == "Point":
        coords = [coords]
    elif kind == "MultiLineString" and isinstance(coords, list):
        coords = [pt for line in coords if isinstance(line, list) for pt in line]
    elif kind not in ("MultiPoint", "LineString"):
        return []
    out = []
    for pt in coords if isinstance(coords, list) else []:
        if (isinstance(pt, list) and len(pt) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool)
                and math.isfinite(v) for v in pt[:2]) and -180 <= pt[0] <= 180 and -90 <= pt[1] <= 90):
            out.append(pt)
        if len(out) >= _MAX_VERTICES:
            break
    return out


def _place(geometry, region):
    """The vertex of the work zone nearest the region's centre that lies inside the monitoring area, with its distance."""
    best = None
    for lon, lat in _vertices(geometry):
        if not (region.bbox_min_lat <= lat <= region.bbox_max_lat and region.bbox_min_lon <= lon <= region.bbox_max_lon):
            continue
        d = haversine_km(region.region_lat, region.region_lon, lat, lon)
        if best is None or d < best[2]:
            best = (lat, lon, d)
    return None if best is None else (best[0], best[1], round(best[2], 2))


def _when(value):
    text = _iso(value)
    return datetime.fromisoformat(text) if text else None


def normalize(features, spec, region, provider_id, now=None):
    """The ``traffic.incidents`` contract from WZDx road-event features (v3.x and v4.x) and a validated spec."""
    now = now or datetime.now(timezone.utc)
    items = []
    for f in features:
        if not isinstance(f, dict) or not isinstance(f.get("properties"), dict):
            continue
        p = f["properties"]
        core = p.get("core_details") if isinstance(p.get("core_details"), dict) else {}
        if core.get("event_type", "work-zone") != "work-zone":
            continue                                    # a detour is not a closure of its own
        if str(p.get("event_status") or "").lower() in ("completed", "cancelled") or not _affects_traffic(p):
            continue
        start, end = _when(p.get("start_date")), _when(p.get("end_date"))
        if (end and end < now) or (start and start > now + _SOON):
            continue
        place = _place(f.get("geometry"), region)
        if place is None:
            continue
        lat, lon, distance = place
        roads = core.get("road_names") if isinstance(core.get("road_names"), list) else []
        road = ", ".join(str(r) for r in roads[:3] if r)
        direction = str(core.get("direction") or "").replace("-", " ")
        where = " ".join(x for x in (road, direction if direction != "undefined" else "") if x)
        title = _clean("Work zone" + (f": {where}" if where else ""))
        description = _clean(core.get("description") or title)
        ident = f.get("id") or core.get("data_source_id") or f"{lat:.5f},{lon:.5f}"
        items.append({"id": f"{provider_id}:{ident}", "title": title, "description": description, "location": where,
                      "link": spec.get("link") or "", "pubDate": _iso(core.get("update_date")),
                      "start": _iso(p.get("start_date")), "sched_end": _iso(p.get("end_date")),
                      "lat": lat, "lon": lon, "dist_km": distance,
                      "severity": _IMPACT.get(str(p.get("vehicle_impact") or "").lower(), "Traffic affected"),
                      "event": "work-zone", "event_sub": "", "ramp": False})
    triaged = triage_incidents(sorted(items, key=lambda item: item["dist_km"])[:_MAX_ITEMS])
    for item in triaged:
        item["unplanned"] = False                       # work zones are scheduled work whatever the wording
    return triaged


class WzdxPoller(BasePoller):
    def __init__(self, provider_id: str, spec: dict):
        self.provider_id, self.spec = provider_id, spec
        self.name = provider_id.replace("-", "_")
        self.interval = spec["poll_seconds"]

    async def poll(self):
        key = self.spec.get("key")
        params = {key["param"]: os.environ.get(key["env"], "")} if key else None
        async with httpx.AsyncClient(timeout=60, headers={"User-Agent": "Vertex/1.0"}) as client:
            data = await read_json(client, self.spec["url"], params=params)
        if not isinstance(data, dict) or not isinstance(data.get("features"), list):
            raise ValueError("The feed is not a WZDx GeoJSON FeatureCollection")
        await set_feed("traffic:incidents", normalize(data["features"], self.spec, settings, self.provider_id),
                       provider_id=self.provider_id)
