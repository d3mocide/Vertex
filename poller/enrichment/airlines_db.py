from __future__ import annotations

import csv
import logging
import os
import re

from config import settings

logger = logging.getLogger(__name__)


class AirlinesDb:
    # Common alliances for major carriers. Unknown carriers return None.
    _ALLIANCE_BY_ICAO = {
        "AAL": "oneworld",
        "BAW": "oneworld",
        "JAL": "oneworld",
        "QFA": "oneworld",
        "FIN": "oneworld",
        "IBE": "oneworld",
        "ACA": "star",
        "DLH": "star",
        "SAS": "star",
        "UAL": "star",
        "THY": "star",
        "AIC": "star",
        "DAL": "skyteam",
        "AFR": "skyteam",
        "KLM": "skyteam",
        "KAL": "skyteam",
        "UAE": None,
        "RYR": None,
        "SWA": None,
    }

    _CALLSIGN_PREFIX_RE = re.compile(r"^([A-Z]{3})")

    def __init__(self):
        self._by_icao: dict[str, dict] = {}
        self._loaded_path: str | None = None
        self._load_first_available()

    def lookup_by_callsign(self, callsign: str | None) -> dict | None:
        prefix = self._extract_prefix(callsign)
        if not prefix:
            return None
        return self._by_icao.get(prefix)

    @classmethod
    def _extract_prefix(cls, callsign: str | None) -> str | None:
        if not callsign:
            return None
        key = str(callsign).strip().upper()
        if not key:
            return None
        match = cls._CALLSIGN_PREFIX_RE.match(key)
        if not match:
            return None
        return match.group(1)

    def _load_first_available(self):
        for candidate in self._candidate_paths():
            if not candidate or not os.path.exists(candidate):
                continue
            count = self._load_dat(candidate)
            self._loaded_path = candidate
            logger.info("[airlines_db] loaded %d entries from %s", count, candidate)
            return

        logger.info("[airlines_db] no airlines DB found; operator/alliance enrichment disabled")

    def _candidate_paths(self) -> list[str]:
        here = os.path.abspath(os.path.dirname(__file__))
        project_poller_root = os.path.abspath(os.path.join(here, ".."))
        app_root = os.path.abspath(os.path.join(project_poller_root, ".."))

        return [
            settings.adsb_airlines_db_path,
            os.path.join(project_poller_root, "airlines.dat"),
            os.path.join(app_root, "airlines.dat"),
            "/data/airlines.dat",
            "/app/airlines.dat",
        ]

    def _load_dat(self, path: str) -> int:
        loaded = 0

        with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.reader(fh)
            for row in reader:
                if len(row) < 8:
                    continue

                name = (row[1] or "").strip()
                iata = (row[3] or "").strip().upper() or None
                icao = (row[4] or "").strip().upper()
                callsign = (row[5] or "").strip() or None
                country = (row[6] or "").strip() or None
                active = (row[7] or "").strip().upper()

                if active != "Y":
                    continue
                if len(icao) != 3 or not icao.isalpha():
                    continue

                self._by_icao[icao] = {
                    "icao": icao,
                    "iata": iata,
                    "name": name or icao,
                    "callsign": callsign,
                    "country": country,
                    "alliance": self._ALLIANCE_BY_ICAO.get(icao),
                }
                loaded += 1

        return loaded
