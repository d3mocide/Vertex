from __future__ import annotations

import gzip
import logging
import os
import re

from config import settings

_ICAO_RE = re.compile(r"^[0-9a-f]{1,6}$")

logger = logging.getLogger(__name__)


class AircraftDb:
    def __init__(self):
        self._entries: dict[str, dict[str, str]] = {}
        self._loaded_path: str | None = None
        self._load_first_available()

    @staticmethod
    def _normalize_icao(icao: str | None) -> str | None:
        if not icao:
            return None
        key = icao.strip().lower()
        if not _ICAO_RE.match(key):
            return None
        return key

    def lookup(self, icao: str | None) -> dict[str, str] | None:
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
            logger.info("[aircraft_db] loaded %d entries from %s", count, candidate)
            return

        logger.info("[aircraft_db] no aircraft DB found; local registry enrichment disabled")

    def _candidate_paths(self) -> list[str]:
        here = os.path.abspath(os.path.dirname(__file__))
        project_poller_root = os.path.abspath(os.path.join(here, ".."))
        app_root = os.path.abspath(os.path.join(project_poller_root, ".."))

        return [
            settings.adsb_aircraft_db_path,
            os.path.join(project_poller_root, "aircraft_db.csv.gz"),
            os.path.join(app_root, "aircraft_db.csv.gz"),
            "/data/aircraft_db.csv.gz",
            "/app/aircraft_db.csv.gz",
        ]

    def _load_csv(self, path: str) -> int:
        loaded = 0
        opener = gzip.open if path.endswith(".gz") else open

        with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                row = line.strip()
                if not row:
                    continue

                parts = row.split(";")
                if len(parts) < 5:
                    continue

                icao = self._normalize_icao(parts[0])
                if not icao:
                    continue

                registration = parts[1].strip()
                type_icao = parts[2].strip()
                type_long = parts[4].strip()

                if not registration and not type_icao and not type_long:
                    continue

                self._entries[icao] = {
                    "registration": registration,
                    "type_icao": type_icao,
                    "type_long": type_long,
                }
                loaded += 1

        return loaded
