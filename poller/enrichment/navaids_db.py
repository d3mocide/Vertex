from __future__ import annotations

import csv
import logging
import math
import os

from config import settings

logger = logging.getLogger(__name__)


class NavaidsDb:
    _ALLOWED_TYPES = {"VOR", "VOR-DME", "VORTAC", "NDB", "NDB-DME", "DME", "TACAN"}

    def __init__(self):
        self._items: list[dict] = []
        self._loaded_path: str | None = None
        self._load_first_available()

    def nearest(self, lat: float | None, lon: float | None, *, max_km: float = 80.0) -> dict | None:
        if lat is None or lon is None:
            return None

        best: dict | None = None
        best_distance = float("inf")

        for item in self._items:
            dist = _haversine_km(lat, lon, item["lat"], item["lon"])
            if dist <= max_km and dist < best_distance:
                best_distance = dist
                best = item

        if not best:
            return None

        return {
            "ident": best.get("ident"),
            "name": best.get("name"),
            "type": best.get("type"),
            "lat": best.get("lat"),
            "lon": best.get("lon"),
            "distance_km": round(best_distance, 1),
        }

    def _load_first_available(self):
        for candidate in self._candidate_paths():
            if not candidate or not os.path.exists(candidate):
                continue
            count = self._load_csv(candidate)
            self._loaded_path = candidate
            logger.info("[navaids_db] loaded %d entries from %s", count, candidate)
            return

        logger.info("[navaids_db] no navaids DB found; navaid enrichment disabled")

    def _candidate_paths(self) -> list[str]:
        here = os.path.abspath(os.path.dirname(__file__))
        project_poller_root = os.path.abspath(os.path.join(here, ".."))
        app_root = os.path.abspath(os.path.join(project_poller_root, ".."))

        return [
            settings.adsb_navaids_db_path,
            os.path.join(project_poller_root, "navaids.csv"),
            os.path.join(app_root, "navaids.csv"),
            "/data/navaids.csv",
            "/app/navaids.csv",
        ]

    def _load_csv(self, path: str) -> int:
        loaded = 0

        with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                navaid_type = (row.get("type") or "").strip().upper()
                if navaid_type not in self._ALLOWED_TYPES:
                    continue

                ident = (row.get("ident") or "").strip().upper()
                if not ident:
                    continue

                lat = _to_float(row.get("latitude_deg"))
                lon = _to_float(row.get("longitude_deg"))
                if lat is None or lon is None:
                    continue

                self._items.append(
                    {
                        "ident": ident,
                        "name": (row.get("name") or "").strip() or ident,
                        "type": navaid_type,
                        "lat": lat,
                        "lon": lon,
                    }
                )
                loaded += 1

        return loaded


def _to_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0088

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat_rad = math.radians(lat2 - lat1)
    dlon_rad = math.radians(lon2 - lon1)

    a = (
        math.sin(dlat_rad / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon_rad / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c
