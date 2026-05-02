import logging
import json
import math
from datetime import datetime, timezone
import httpx
from db import write_event
from bus import get_bus
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# In-memory deduplication for this process lifetime.
# On restart, at most ~1 hour of earthquakes may be re-written — acceptable.
_seen_ids: set[str] = set()


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


class SeismicPoller(BasePoller):
    name = "seismic"
    interval = 60

    async def poll(self):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(_USGS_FEED, headers=_HEADERS)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.warning("[seismic] USGS fetch failed: %s", exc)
            return

        features = data.get("features", [])
        new_count = 0

        for feature in features:
            eid = feature.get("id", "")
            if not eid or eid in _seen_ids:
                continue

            props = feature.get("properties") or {}
            mag = props.get("mag")
            if mag is None:
                continue

            place = props.get("place") or "Unknown location"
            mag_type = props.get("magType") or "M"
            coords = (feature.get("geometry") or {}).get("coordinates") or []
            
            lon = coords[0] if len(coords) >= 1 else None
            lat = coords[1] if len(coords) >= 2 else None
            depth_km = coords[2] if len(coords) >= 3 else None

            if lat is None or lon is None:
                continue

            # Distance-based gating
            dist_km = _haversine_km(lat, lon, settings.region_lat, settings.region_lon)
            if dist_km <= 300:
                pass  # Local (< ~160 nm): accept all
            elif dist_km <= 1500:
                if mag < 3.0:
                    continue  # Regional (< ~800 nm): accept >= 3.0
            else:
                if mag < 5.0:
                    continue  # Global: accept >= 5.0

            if mag >= 5.0:
                severity = "high"
            elif mag >= 3.0:
                severity = "medium"
            else:
                severity = "low"

            summary = f"{mag_type}{mag:.1f} — {place}"
            if depth_km is not None:
                summary += f" (depth {depth_km:.0f} km)"

            details = {
                "magnitude": mag,
                "mag_type": mag_type,
                "place": place,
                "depth_km": depth_km,
                "usgs_id": eid,
                "url": props.get("url") or "",
                "lat": lat,
                "lon": lon,
            }

            try:
                event_id = await write_event(
                    event_type="seismic",
                    entity_id=None,
                    severity=severity,
                    summary=summary,
                    details=details,
                )

                if event_id:
                    r = await get_bus()
                    await r.publish(
                        "civic:updates",
                        json.dumps(
                            {
                                "type": "event",
                                "data": {
                                    "event_id": event_id,
                                    "event_type": "seismic",
                                    "entity_id": None,
                                    "ts": datetime.now(timezone.utc).isoformat(),
                                    "severity": severity,
                                    "summary": summary,
                                    "details": details,
                                },
                            }
                        ),
                    )
                _seen_ids.add(eid)
                new_count += 1
            except Exception as exc:
                logger.warning("[seismic] write_event failed for %s: %s", eid, exc)

        if new_count:
            logger.info("[seismic] recorded %d new earthquake event(s)", new_count)
