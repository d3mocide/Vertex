from __future__ import annotations

import csv
import logging
import os

from config import settings

logger = logging.getLogger(__name__)


class AirportsDb:
    _ALLOWED_TYPES = {"small_airport", "medium_airport", "large_airport"}

    def __init__(self):
        self._entries: dict[str, dict] = {}
        self._loaded_path: str | None = None
        self._load_first_available()

    @staticmethod
    def _normalize_icao(icao: str | None) -> str | None:
        if not icao:
            return None
        key = icao.strip().upper()
        if len(key) != 4 or not key.isalnum():
            return None
        return key

    def lookup(self, icao: str | None) -> dict | None:
        key = self._normalize_icao(icao)
        if not key:
            return None
        return self._entries.get(key)

    def _load_first_available(self):
        for candidate in self._candidate_paths():
            if not candidate or not os.path.exists(candidate):
                continue
            count = self._load_csv(candidate)
            self._loaded_path = candidate
            logger.info("[airports_db] loaded %d entries from %s", count, candidate)
            return

        logger.info("[airports_db] no airports DB found; airport metadata enrichment disabled")

    def _candidate_paths(self) -> list[str]:
        here = os.path.abspath(os.path.dirname(__file__))
        project_poller_root = os.path.abspath(os.path.join(here, ".."))
        app_root = os.path.abspath(os.path.join(project_poller_root, ".."))

        return [
            settings.adsb_airports_db_path,
            os.path.join(project_poller_root, "airports.csv"),
            os.path.join(app_root, "airports.csv"),
            "/data/airports.csv",
            "/app/airports.csv",
        ]

    def _load_csv(self, path: str) -> int:
        loaded = 0

        with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                icao = self._normalize_icao(row.get("ident"))
                if not icao:
                    continue

                airport_type = (row.get("type") or "").strip().lower()
                if airport_type not in self._ALLOWED_TYPES:
                    continue

                lat = self._to_float(row.get("latitude_deg"))
                lon = self._to_float(row.get("longitude_deg"))
                if lat is None or lon is None:
                    continue

                self._entries[icao] = {
                    "icao": icao,
                    "name": (row.get("name") or "").strip() or icao,
                    "city": (row.get("municipality") or "").strip() or None,
                    "country": (row.get("iso_country") or "").strip() or None,
                    "type": airport_type,
                    "lat": lat,
                    "lon": lon,
                }
                loaded += 1

        return loaded

    @staticmethod
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
