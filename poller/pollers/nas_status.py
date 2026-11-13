"""
FAA NAS Status — ground stops, ground delay programs, delays and airport closures.

The FAA publishes one small XML document of every active national airspace
program (the same data the ATCSCC advisories announce). Every 60 s it is
fetched, reduced to the airports inside the monitoring area (the BBOX_* box,
from the bundled `data/us_airports.csv`) plus any extras in `NAS_STATUS_AIRPORTS`,
and stored as `feed:faa:nas_status`. Only changes are republished.
"""
import csv
import hashlib
import json
import logging
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

import httpx

from bus import get_bus, set_feed, touch_feed
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_URL = "https://nasstatus.faa.gov/api/airport-status-information"
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}
_MAX_BYTES = 2_000_000
FEED_KEY = "faa:nas_status"


def _t(el, tag: str) -> str:
    return (el.findtext(tag) or "").strip()


def parse(xml_bytes: bytes) -> dict:
    """NAS Status XML → {"updated": str, "programs": [...]}. Raises ET.ParseError on junk."""
    root = ET.fromstring(xml_bytes)
    programs: list[dict] = []
    for group in root.findall("Delay_type"):
        for p in group.iter("Program"):
            programs.append({"kind": "ground_stop", "airport": _t(p, "ARPT"), "reason": _t(p, "Reason"),
                             "until": _t(p, "End_Time")})
        for p in group.iter("Ground_Delay"):
            programs.append({"kind": "ground_delay", "airport": _t(p, "ARPT"), "reason": _t(p, "Reason"),
                             "avg": _t(p, "Avg"), "max": _t(p, "Max")})
        for p in group.iter("Delay"):
            ad = p.find("Arrival_Departure")
            programs.append({"kind": "delay", "airport": _t(p, "ARPT"), "reason": _t(p, "Reason"),
                             "direction": (ad.get("Type") if ad is not None else "") or "",
                             "min": _t(ad, "Min") if ad is not None else "",
                             "max": _t(ad, "Max") if ad is not None else "",
                             "trend": _t(ad, "Trend") if ad is not None else ""})
        for p in group.iter("Airport"):
            programs.append({"kind": "closure", "airport": _t(p, "ARPT"), "reason": _t(p, "Reason"),
                             "start": _t(p, "Start"), "reopen": _t(p, "Reopen")})
    return {"updated": _t(root, "Update_Time"), "programs": [p for p in programs if p["airport"]]}


_AIRPORTS = Path(__file__).resolve().parent.parent / "data" / "us_airports.csv"


@lru_cache(maxsize=1)
def _airports() -> tuple[tuple[str, float, float], ...]:
    with open(_AIRPORTS, newline="", encoding="utf-8") as f:
        return tuple((r["code"].upper(), float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f))


def airports_in_box(min_lat: float, max_lat: float, min_lon: float, max_lon: float) -> set[str]:
    return {c for c, lat, lon in _airports() if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon}


def watched(codes: str) -> set[str]:
    return {c.strip().upper() for c in codes.split(",") if c.strip()}


def filter_programs(data: dict, codes: set[str]) -> dict:
    """Keep programs at watched airports. FAA codes are 3 letters; ICAO adds a leading K."""
    keep = {c[1:] if len(c) == 4 and c.startswith("K") else c for c in codes}
    return {"updated": data["updated"], "programs": [p for p in data["programs"] if p["airport"].upper() in keep]}


def national(data: dict) -> dict:
    """US-wide counts, whatever the watch list: a nationwide stop lists every airport, not just ours."""
    us = {c for c, _, _ in _airports()}
    stops = {p["airport"].upper() for p in data["programs"] if p["kind"] == "ground_stop"} & us
    delays = {p["airport"].upper() for p in data["programs"] if p["kind"] == "ground_delay"} & us
    return {"ground_stops": len(stops), "ground_delays": len(delays)}


class NasStatusPoller(BasePoller):
    name = "nas_status"
    interval = 60

    def __init__(self):
        self._last_hash = ""

    async def poll(self):
        codes = watched(settings.nas_status_airports) | airports_in_box(
            settings.bbox_min_lat, settings.bbox_max_lat, settings.bbox_min_lon, settings.bbox_max_lon)
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            resp = await client.get(_URL)
            resp.raise_for_status()
        if len(resp.content) > _MAX_BYTES:
            logger.warning("[nas_status] response too large, ignored")
            return
        try:
            full = parse(resp.content)
            data = filter_programs(full, codes)
            data["national"] = national(full)
            data["national"]["nationwide"] = data["national"]["ground_stops"] >= settings.nas_status_national_threshold
        except ET.ParseError as exc:
            logger.warning("[nas_status] XML parse error: %s", exc)
            return
        digest = hashlib.sha1(json.dumps([data["programs"], data["national"]], sort_keys=True).encode()).hexdigest()
        if digest != self._last_hash:
            self._last_hash = digest
            await set_feed(FEED_KEY, data, broadcast=False)
        else:
            await touch_feed(FEED_KEY)
