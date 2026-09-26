"""
Local street-name gazetteer for correcting ASR-garbled street names.

Dispatch audio transcribed by ASR mangles street names ("Clariton" for
Clarendon, "Cooch" for Couch, "Dark" for Stark). Exact-match geocoding then
misses. This module keeps every named street in the operating box (from
OpenStreetMap via Overpass — only the bounding box is sent) in a PostgreSQL
table with trigram and Levenshtein indexes, and proposes close matches with
the same direction prefix and street type.

Suggestions are only candidates: the geocoder accepts a correction only if
Nominatim then finds the exact house number on it (or the corrected streets
actually intersect), so a wrong guess can never place a pin by itself.
"""
from __future__ import annotations

import logging
import re
import time

import httpx

from config import settings
from radio_incidents import _DIR, _SUFFIX

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_REFRESH_AFTER_S = 30 * 86400
_HIGHWAY_TYPES = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road"

# Full-word forms used by OpenStreetMap -> the abbreviations the extractor emits.
_DIR_WORDS = {"north": "N", "south": "S", "east": "E", "west": "W", "northeast": "NE",
              "northwest": "NW", "southeast": "SE", "southwest": "SW"}
_ABBREVS = {**{k: v for k, v in _DIR.items()}, **_DIR_WORDS}
_SUFFIXES = {**_SUFFIX, **{v.lower(): v for v in _SUFFIX.values()}}
# Spoken forms dispatch uses for long official names.
_ALIASES = {"mlk junior": "martin luther king junior", "mlk jr": "martin luther king junior",
            "mlk": "martin luther king junior"}


def parse_street(name: str) -> tuple[str, str, str] | None:
    """'North Clarendon Avenue' / 'N Clariton Ave' / 'Lloyd Court Southeast' -> ('N', 'clarendon', 'Ave')."""
    words = re.sub(r"[^\w\s]", " ", name.lower()).split()
    if len(words) < 2:
        return None
    direction = ""
    if words[0] in _ABBREVS:
        direction = _ABBREVS[words.pop(0)]
    elif len(words) > 2 and words[-1] in _ABBREVS:  # trailing direction: "Lloyd Court Southeast"
        direction = _ABBREVS[words.pop()]
    if len(words) < 2 or words[-1] not in _SUFFIXES:
        return None
    suffix = _SUFFIXES[words.pop()]
    core = " ".join(words)
    return direction, _ALIASES.get(core, core), suffix


def format_street(direction: str, core: str, suffix: str) -> str:
    return " ".join(p for p in (direction, core.title(), suffix) if p)


async def ensure_schema(pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        await conn.execute("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch")
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS street_names ("
            " dir TEXT NOT NULL, core TEXT NOT NULL, suffix TEXT NOT NULL,"
            " loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (dir, core, suffix))"
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS ix_street_names_core_trgm ON street_names USING gin (core gin_trgm_ops)")


async def refresh_if_stale(pool) -> int:
    """Load street names from Overpass when the table is empty or older than 30 days."""
    await ensure_schema(pool)
    loaded_at = await pool.fetchval("SELECT extract(epoch FROM max(loaded_at)) FROM street_names")
    if loaded_at and time.time() - float(loaded_at) < _REFRESH_AFTER_S:
        return 0
    query = (
        f'[out:csv(name;false)][timeout:180];'
        f'way["highway"~"^({_HIGHWAY_TYPES})$"]["name"]'
        f'({settings.bbox_min_lat},{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon});'
        f'out tags;'
    )
    async with httpx.AsyncClient(timeout=240, headers={"User-Agent": "Vertex/1.0 street gazetteer"}) as client:
        resp = await client.post(_OVERPASS_URL, data={"data": query})
        resp.raise_for_status()
    rows = {parsed for line in resp.text.splitlines() if (parsed := parse_street(line))}
    if not rows:
        logger.warning("[streets] Overpass returned no parsable street names — keeping existing table")
        return 0
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("TRUNCATE street_names")
        await conn.copy_records_to_table("street_names", records=list(rows), columns=["dir", "core", "suffix"])
    logger.info("[streets] loaded %d street names for fuzzy geocoding", len(rows))
    return len(rows)


async def suggest(pool, street: str, limit: int = 3) -> list[str]:
    """Closest real streets to an ASR-garbled one, same direction and type, best first."""
    parsed = parse_street(street)
    if pool is None or parsed is None:
        return []
    direction, core, suffix = parsed
    rows = await pool.fetch(
        """
        SELECT dir, core, suffix,
               -- Spelling distance, discounted when the names sound alike
               -- (Double Metaphone: "gleason"/"glisan" -> KLSN).
               levenshtein(core, $2) - CASE WHEN dmetaphone(core) = dmetaphone($2) THEN 3 ELSE 0 END AS score,
               similarity(core, $2) AS sim
        FROM street_names
        WHERE suffix = $3
          AND ($1 = '' OR dir = $1 OR dir = '')
          AND (core % $2
               OR levenshtein(core, $2) <= greatest(2, length($2) / 3)
               OR dmetaphone(core) = dmetaphone($2))
        ORDER BY score, sim DESC, (dir = $1) DESC
        LIMIT $4
        """,
        direction, core, suffix, limit * 3,
    )
    heard = street.strip().lower()
    out: list[str] = []
    for r in rows:
        cand = format_street(r["dir"] or direction, r["core"], r["suffix"])
        # Drop the street exactly as heard (already tried) and duplicates; keep alias expansions.
        if cand.lower() != heard and cand not in out:
            out.append(cand)
    return out[:limit]
