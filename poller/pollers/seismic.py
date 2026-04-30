import logging
import json
from datetime import datetime, timezone
import httpx
from db import write_event
from bus import get_bus
from .base import BasePoller

logger = logging.getLogger(__name__)

_USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
_HEADERS = {"User-Agent": "Vertex/1.0 (Situational Awareness Dashboard)"}

# In-memory deduplication for this process lifetime.
# On restart, at most ~1 hour of earthquakes may be re-written — acceptable.
_seen_ids: set[str] = set()


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
            depth_km = coords[2] if len(coords) >= 3 else None

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
                "lat": coords[1] if len(coords) >= 2 else None,
                "lon": coords[0] if len(coords) >= 1 else None,
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
