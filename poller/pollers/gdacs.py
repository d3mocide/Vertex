import json
import logging
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from bus import get_bus
from db import write_event
from normalizers.beast_math import haversine_km
from config import settings
from sanitize import sanitize_payload
from .base import BasePoller

logger = logging.getLogger(__name__)

_GDACS_RSS = "https://www.gdacs.org/xml/rss.xml"
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# XML namespaces used by GDACS GeoRSS feed
_NS = {
    "gdacs": "http://www.gdacs.org",
    "geo":   "http://www.w3.org/2003/01/geo/wgs84_pos#",
    "georss":"http://www.georss.org/georss",
}

# Event type code → human-readable label
_EVENT_LABELS = {
    "EQ": "Earthquake",
    "TC": "Tropical Cyclone",
    "FL": "Flood",
    "VO": "Volcano",
    "WF": "Wildfire",
    "DR": "Drought",
    "TS": "Tsunami",
}

# Deduplication: maps "eventid:episodeid" → ingestion timestamp
_seen: dict[str, float] = {}


def _alert_severity(level: str) -> str:
    return {"Red": "high", "Orange": "medium"}.get(level, "low")


def _distance_gating(dist_km: float, level: str) -> bool:
    """Return True if the event should be ingested given its distance and alert level."""
    if level == "Red":
        return True  # Red alerts always matter globally
    if level == "Orange":
        return dist_km <= 8000
    # Green: only nearby events
    return dist_km <= 1500


def _parse_float(el: ET.Element | None, attr: str | None = None) -> float | None:
    if el is None:
        return None
    try:
        text = el.get(attr) if attr else el.text
        return float(text) if text else None
    except (ValueError, TypeError):
        return None


def _parse_pub_date(item: ET.Element) -> datetime | None:
    el = item.find("pubDate")
    if el is None or not el.text:
        return None
    try:
        return parsedate_to_datetime(el.text).astimezone(timezone.utc)
    except Exception:
        return None


class GdacsPoller(BasePoller):
    name = "gdacs"
    interval = 900  # 15 minutes — GDACS updates every 15 min

    async def poll(self):
        try:
            async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
                resp = await client.get(_GDACS_RSS)
                resp.raise_for_status()
                content = resp.content
        except Exception as exc:
            logger.warning("[gdacs] fetch failed: %s", exc)
            return

        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            logger.warning("[gdacs] XML parse error: %s", exc)
            return

        # Evict dedup cache older than 48 hours
        cutoff = time.time() - 172800
        for k in [k for k, v in _seen.items() if v < cutoff]:
            del _seen[k]

        channel = root.find("channel")
        if channel is None:
            return

        new_count = 0
        for item in channel.findall("item"):
            event_type = (item.findtext("gdacs:eventtype", namespaces=_NS) or "").strip()
            event_id   = (item.findtext("gdacs:eventid",   namespaces=_NS) or "").strip()
            episode_id = (item.findtext("gdacs:episodeid",  namespaces=_NS) or "").strip()
            alert_level = (item.findtext("gdacs:alertlevel", namespaces=_NS) or "Green").strip()

            if not event_id:
                continue

            dedup_key = f"{event_id}:{episode_id}"
            if dedup_key in _seen:
                continue

            # Coordinates — prefer geo:lat/geo:long, fall back to georss:point
            lat_el  = item.find("geo:lat",  _NS)
            lon_el  = item.find("geo:long", _NS)
            lat = _parse_float(lat_el)
            lon = _parse_float(lon_el)

            if lat is None or lon is None:
                point_el = item.find("georss:point", _NS)
                if point_el is not None and point_el.text:
                    parts = point_el.text.split()
                    if len(parts) == 2:
                        try:
                            lat, lon = float(parts[0]), float(parts[1])
                        except ValueError:
                            pass

            if lat is None or lon is None:
                continue

            dist_km = haversine_km(lat, lon, settings.region_lat, settings.region_lon)
            if not _distance_gating(dist_km, alert_level):
                continue

            title   = (item.findtext("title") or "").strip()
            link    = (item.findtext("link")  or "").strip()
            country = (item.findtext("gdacs:country", namespaces=_NS) or "").strip()
            pub_dt  = _parse_pub_date(item)

            severity_el = item.find("gdacs:severity", _NS)
            severity_val = _parse_float(severity_el, "value")
            severity_unit = (severity_el.get("unit") if severity_el is not None else None) or ""

            label = _EVENT_LABELS.get(event_type, event_type or "Disaster")
            summary = title or f"{alert_level} {label}"
            if country:
                summary = f"{summary} — {country}"

            details = {
                "lat": lat,
                "lon": lon,
                "event_type_code": event_type,
                "event_label": label,
                "alert_level": alert_level,
                "severity_value": severity_val,
                "severity_unit": severity_unit,
                "country": country,
                "gdacs_event_id": event_id,
                "gdacs_episode_id": episode_id,
                "url": link,
                "dist_km": round(dist_km, 1),
                "pub_ts": pub_dt.isoformat() if pub_dt else None,
            }

            severity = _alert_severity(alert_level)
            try:
                ev_id = await write_event(
                    event_type="gdacs",
                    entity_id=None,
                    severity=severity,
                    summary=summary,
                    details=details,
                )
                if ev_id:
                    r = await get_bus()
                    await r.publish(
                        "civic:updates",
                        json.dumps(sanitize_payload({
                            "type": "event",
                            "data": {
                                "event_id": ev_id,
                                "event_type": "gdacs",
                                "entity_id": None,
                                "ts": (pub_dt or datetime.now(timezone.utc)).isoformat(),
                                "severity": severity,
                                "summary": summary,
                                "details": details,
                            },
                        })),
                    )
                _seen[dedup_key] = time.time()
                new_count += 1
            except Exception as exc:
                logger.warning("[gdacs] write_event failed for %s: %s", dedup_key, exc)

        if new_count:
            logger.info("[gdacs] recorded %d new disaster event(s)", new_count)
