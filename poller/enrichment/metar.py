from __future__ import annotations

import logging
import os
from typing import Optional
from urllib.parse import quote

import httpx

from config import settings
from .cache import CachedLookup, HttpThrottle, UpstreamRateLimitedError, load_gzip_json, save_gzip_json

logger = logging.getLogger(__name__)


class MetarClient:
    BASE_URL = "https://aviationweather.gov/api/data/metar"

    def __init__(self):
        self._cache_path = os.path.join(settings.adsb_enrichment_cache_dir, "metar.json.gz")
        self._lookup = CachedLookup[dict](
            positive_ttl_seconds=10 * 60,
            negative_ttl_seconds=5 * 60,
            max_size=2000,
            throttle=HttpThrottle(min_interval_seconds=2.0, default_cooldown_seconds=120),
        )
        self._load_cache()

    @staticmethod
    def normalize_icao(icao: str | None) -> str | None:
        if not icao:
            return None
        key = icao.strip().upper()
        if len(key) != 4 or not key.isalnum():
            return None
        return key

    def lookup_cached(self, icao: str | None) -> tuple[bool, dict | None]:
        key = self.normalize_icao(icao)
        if not key:
            return True, None
        return self._lookup.lookup_cached(key)

    async def lookup_one(self, icao: str | None) -> dict | None:
        key = self.normalize_icao(icao)
        if not key:
            return None
        result = await self._lookup.get(key, self._fetch_one)
        self._persist_cache()
        return result

    async def lookup_many(self, icaos: list[str]) -> dict[str, dict | None]:
        clean = [k for i in icaos if (k := self.normalize_icao(i))]
        if not clean:
            return {}

        result: dict[str, dict | None] = {}
        missing: list[str] = []
        for icao in clean:
            known, cached = self._lookup.lookup_cached(icao)
            if known:
                result[icao] = cached
            else:
                missing.append(icao)

        if not missing:
            return result

        try:
            fetched = await self._fetch_batch(missing)
        except UpstreamRateLimitedError:
            fetched = {icao: self._lookup.get_stale(icao) for icao in missing}
        except httpx.HTTPError as exc:
            # METAR batch lookups are often fired as background tasks; treat transient
            # upstream failures as soft misses so they do not surface as unhandled task errors.
            logger.warning("[metar] upstream request failed for %d ICAOs: %s", len(missing), exc)
            fetched = {icao: self._lookup.get_stale(icao) for icao in missing}
        except Exception as exc:
            logger.warning("[metar] batch lookup failed for %d ICAOs: %s", len(missing), exc)
            fetched = {icao: self._lookup.get_stale(icao) for icao in missing}
        result.update(fetched)
        self._persist_cache()
        return result

    def _load_cache(self):
        payload = load_gzip_json(self._cache_path) or {}
        if not isinstance(payload, dict):
            return
        if int(payload.get("schema_version", 0)) != 1:
            return
        self._lookup.import_entries(payload.get("entries"))

    def _persist_cache(self):
        payload = {
            "schema_version": 1,
            "entries": self._lookup.export_entries(),
        }
        save_gzip_json(self._cache_path, payload)

    async def _fetch_one(self, key: str) -> Optional[dict]:
        result = await self._fetch_batch([key])
        return result.get(key)

    async def _fetch_batch(self, keys: list[str]) -> dict[str, dict | None]:
        ids = quote(",".join(sorted(set(keys))))
        url = f"{self.BASE_URL}?ids={ids}&format=json&taf=false&hours=1"

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Vertex/1.0 (METAR enrichment)",
                },
            )
        if resp.status_code == 429:
            raise UpstreamRateLimitedError(_parse_retry_after(resp.headers.get("Retry-After")))
        resp.raise_for_status()

        # 204 No Content — valid response meaning no observations for these ICAOs right now.
        if resp.status_code == 204:
            logger.debug("[metar] no observations for ids=%s (204)", ids)
            return {k: None for k in keys}

        try:
            payload = resp.json() or []
        except ValueError:
            content_type = resp.headers.get("content-type", "")
            preview = (resp.text or "")[:120].replace("\n", " ")
            logger.warning(
                "[metar] non-JSON response for ids=%s (status=%s, content-type=%s, preview=%r)",
                ids,
                resp.status_code,
                content_type,
                preview,
            )
            return {k: None for k in keys}

        if not isinstance(payload, list):
            logger.warning("[metar] unexpected payload type for ids=%s: %s", ids, type(payload).__name__)
            return {k: None for k in keys}

        by_icao: dict[str, dict | None] = {k: None for k in keys}
        for item in payload:
            if not isinstance(item, dict):
                continue
            icao = self.normalize_icao(item.get("icaoId"))
            if not icao or icao not in by_icao:
                continue
            by_icao[icao] = {
                "raw": item.get("rawOb"),
                "obs_time": item.get("obsTime"),
                "wind_dir": item.get("wdir"),
                "wind_kt": item.get("wspd"),
                "gust_kt": item.get("wgst"),
                "visibility": item.get("visib"),
                "temp_c": item.get("temp"),
                "dewpoint_c": item.get("dewp"),
                "altimeter_hpa": item.get("altim"),
            }

        return by_icao


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value.strip())
        if seconds <= 0:
            return None
        return seconds
    except (TypeError, ValueError):
        return None
