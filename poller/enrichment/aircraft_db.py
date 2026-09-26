from __future__ import annotations

import gzip
import logging
import os
import re
from array import array
from bisect import bisect_left

from config import settings

_ICAO_RE = re.compile(r"^[0-9a-f]{1,6}$")

logger = logging.getLogger(__name__)


class AircraftDb:
    """Read-only ICAO -> registration/type lookup over the tar1090 aircraft DB.

    ~600k rows are stored in flat arrays instead of a dict of dicts: sorted
    24-bit ICAO addresses (array 'I'), registrations packed into one bytes
    blob with offsets, and a 2-byte index into the ~15k distinct
    (type_icao, type_long) pairs. That is ~15 MB instead of ~240 MB; lookups
    are a binary search and rebuild the same dict shape callers expect.
    """

    def __init__(self):
        self._icaos = array("I")
        self._reg_offsets = array("I", [0])
        self._reg_blob = b""
        self._type_idx = array("H")
        self._types: list[tuple[str, str]] = []
        self._loaded_path: str | None = None
        self._load_first_available()

    def __len__(self) -> int:
        return len(self._icaos)

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
        code = int(key, 16)
        i = bisect_left(self._icaos, code)
        if i == len(self._icaos) or self._icaos[i] != code:
            return None
        reg = self._reg_blob[self._reg_offsets[i]:self._reg_offsets[i + 1]].decode("utf-8", "replace")
        type_icao, type_long = self._types[self._type_idx[i]]
        return {"registration": reg, "type_icao": type_icao, "type_long": type_long}

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
        opener = gzip.open if path.endswith(".gz") else open
        icaos, type_idx, offsets = array("I"), array("H"), array("I", [0])
        blob = bytearray()
        type_ids: dict[tuple[str, str], int] = {}
        types: list[tuple[str, str]] = []
        in_order = True

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
                type_pair = (parts[2].strip(), parts[4].strip())

                if not registration and not type_pair[0] and not type_pair[1]:
                    continue

                tid = type_ids.get(type_pair)
                if tid is None:
                    tid = type_ids[type_pair] = len(types)
                    types.append(type_pair)
                code = int(icao, 16)
                if icaos and code <= icaos[-1]:
                    in_order = False
                icaos.append(code)
                type_idx.append(tid)
                blob += registration.encode("utf-8")
                offsets.append(len(blob))

        if not in_order:
            icaos, type_idx, offsets, blob = self._sort_dedupe(icaos, type_idx, offsets, blob)
        self._icaos, self._type_idx, self._reg_offsets = icaos, type_idx, offsets
        self._reg_blob, self._types = bytes(blob), types
        return len(icaos)

    @staticmethod
    def _sort_dedupe(icaos, type_idx, offsets, blob):
        """Sort by ICAO; on duplicate addresses the later row wins (as the old dict did)."""
        order = sorted(range(len(icaos)), key=lambda i: (icaos[i], i))
        out_i, out_t, out_o, out_b = array("I"), array("H"), array("I", [0]), bytearray()
        for n, i in enumerate(order):
            if n + 1 < len(order) and icaos[order[n + 1]] == icaos[i]:
                continue  # a later row has the same address
            out_i.append(icaos[i])
            out_t.append(type_idx[i])
            out_b += blob[offsets[i]:offsets[i + 1]]
            out_o.append(len(out_b))
        return out_i, out_t, out_o, out_b
