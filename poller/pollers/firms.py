"""
NASA FIRMS satellite fire detections (VIIRS near-real-time).

Thermal anomalies seen from orbit typically show up hours before an incident
is reported to EONET/NIFC, so this is the early-warning fire feed. Needs a free
MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/); without one the
poller stays idle. Detections within `firms_radius_km` of the region centre are
published as feed:fire:hotspots for the Environment page.
"""

import csv
import io
import logging
import math
from datetime import datetime, timezone

import httpx

from bus import set_feed
from config import settings
from normalizers.beast_math import haversine_km
from .base import BasePoller

logger = logging.getLogger(__name__)

_FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{west},{south},{east},{north}/1"
_SOURCES = ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")
_MAX_HOTSPOTS = 500
_DEDUPE_DEG = 0.004   # ~400 m: the same fire seen by two satellites in one pass


def _bbox(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * math.cos(math.radians(abs(lat))))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat   # west, south, east, north


def parse_firms_csv(text: str, lat: float, lon: float, radius_km: float) -> list[dict]:
    """VIIRS CSV rows → hotspots within radius, low-confidence detections dropped."""
    out: list[dict] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            hlat, hlon = float(row["latitude"]), float(row["longitude"])
        except (KeyError, ValueError, TypeError):
            continue
        conf = (row.get("confidence") or "").strip().lower()
        if conf in ("l", "low"):
            continue
        dist = haversine_km(hlat, hlon, lat, lon)
        if dist > radius_km:
            continue
        try:
            hhmm = (row.get("acq_time") or "0000").zfill(4)
            ts = datetime.strptime(f"{row['acq_date']} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        try:
            frp = float(row.get("frp")) if row.get("frp") not in (None, "") else None
        except ValueError:
            frp = None
        out.append({
            "lat": hlat, "lon": hlon, "ts": ts.isoformat(),
            "sat": row.get("satellite"), "frp": frp,
            "confidence": "high" if conf in ("h", "high") else "nominal",
            "daynight": row.get("daynight"), "dist_km": round(dist, 1),
        })
    return out


def merge_hotspots(hotspots: list[dict]) -> list[dict]:
    """Newest first; one pin where several satellites saw the same spot."""
    kept: list[dict] = []
    for h in sorted(hotspots, key=lambda x: x["ts"], reverse=True):
        if any(abs(h["lat"] - k["lat"]) < _DEDUPE_DEG and abs(h["lon"] - k["lon"]) < _DEDUPE_DEG for k in kept):
            continue
        kept.append(h)
    return kept[:_MAX_HOTSPOTS]


class FirmsPoller(BasePoller):
    name = "firms"
    interval = 900   # NRT data lands every ~3 h per satellite; 15 min is plenty

    async def setup(self):
        if not settings.firms_map_key:
            logger.warning("[firms] FIRMS_MAP_KEY not set — satellite hotspots disabled.")

    async def poll(self):
        if not settings.firms_map_key:
            return
        west, south, east, north = _bbox(settings.region_lat, settings.region_lon, settings.firms_radius_km)
        found: list[dict] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for source in _SOURCES:
                url = _FIRMS_URL.format(key=settings.firms_map_key, source=source,
                                        west=round(west, 4), south=round(south, 4),
                                        east=round(east, 4), north=round(north, 4))
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    found.extend(parse_firms_csv(resp.text, settings.region_lat, settings.region_lon,
                                                 settings.firms_radius_km))
                except Exception as exc:
                    # Never log the URL: the MAP_KEY is in the path.
                    logger.warning("[firms] %s fetch failed: %s", source, type(exc).__name__)
        await set_feed("fire:hotspots", merge_hotspots(found))
