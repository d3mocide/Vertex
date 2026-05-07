from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

from config import settings
from .cache import CachedLookup, HttpThrottle, UpstreamRateLimitedError, load_gzip_json, save_gzip_json

logger = logging.getLogger(__name__)


class AdsbdbClient:
    _PERSIST_EVERY = 20  # write cache file after this many new fetches

    def __init__(self):
        throttle = HttpThrottle(min_interval_seconds=1.2, default_cooldown_seconds=60)
        self._cache_path = os.path.join(settings.adsb_enrichment_cache_dir, "flight_routes.json.gz")
        self._routes = CachedLookup[dict](
            positive_ttl_seconds=12 * 3600,
            negative_ttl_seconds=3600,
            max_size=10000,
            throttle=throttle,
        )
        self._aircraft = CachedLookup[dict](
            positive_ttl_seconds=30 * 86400,
            negative_ttl_seconds=24 * 3600,
            max_size=10000,
            throttle=throttle,
        )
        self._dirty_count: int = 0
        self._load_cache()

    @staticmethod
    def normalize_callsign(callsign: str | None) -> str | None:
        if not callsign:
            return None
        key = callsign.strip().upper()
        if len(key) < 3 or len(key) > 8:
            return None
        if not key.isalnum():
            return None
        return key

    @staticmethod
    def normalize_icao(icao: str | None) -> str | None:
        if not icao:
            return None
        key = icao.strip().lower()
        if not key or len(key) > 6:
            return None
        if any(c not in "0123456789abcdef" for c in key):
            return None
        return key

    def lookup_cached_route(self, callsign: str | None) -> tuple[bool, dict | None]:
        key = self.normalize_callsign(callsign)
        if not key:
            return True, None
        return self._routes.lookup_cached(key)

    def lookup_cached_aircraft(self, icao: str | None) -> tuple[bool, dict | None]:
        key = self.normalize_icao(icao)
        if not key:
            return True, None
        return self._aircraft.lookup_cached(key)

    async def lookup_route(self, callsign: str | None) -> dict | None:
        key = self.normalize_callsign(callsign)
        if not key:
            return None
        result = await self._routes.get(key, self._fetch_route)
        self._mark_dirty()
        return result

    async def lookup_aircraft(self, icao: str | None) -> dict | None:
        key = self.normalize_icao(icao)
        if not key:
            return None
        result = await self._aircraft.get(key, self._fetch_aircraft)
        self._mark_dirty()
        return result

    def _mark_dirty(self) -> None:
        """Increment the dirty counter and flush to disk every _PERSIST_EVERY fetches.

        Batching writes prevents a gzip I/O call (blocking) on every single enrichment
        lookup. The cache is also flushed at poller shutdown via flush().
        """
        self._dirty_count += 1
        if self._dirty_count % self._PERSIST_EVERY == 0:
            self._persist_cache()

    def flush(self) -> None:
        """Force an immediate cache flush — call on poller shutdown."""
        if self._dirty_count > 0:
            self._persist_cache()

    def _load_cache(self):
        payload = load_gzip_json(self._cache_path) or {}
        if not isinstance(payload, dict):
            return
        if int(payload.get("schema_version", 0)) != 1:
            return
        self._routes.import_entries(payload.get("routes"))
        self._aircraft.import_entries(payload.get("aircraft"))

    def _persist_cache(self):
        payload = {
            "schema_version": 1,
            "routes": self._routes.export_entries(),
            "aircraft": self._aircraft.export_entries(),
        }
        save_gzip_json(self._cache_path, payload)

    async def _fetch_route(self, key: str) -> Optional[dict]:
        url = f"https://api.adsbdb.com/v0/callsign/{key}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
        if resp.status_code == 429:
            raise UpstreamRateLimitedError(_parse_retry_after(resp.headers.get("Retry-After")))
        if resp.status_code in (400, 404):
            return None
        resp.raise_for_status()
        body = resp.json() or {}
        route = ((body.get("response") or {}).get("flightroute") or {})
        origin = ((route.get("origin") or {}).get("icao_code"))
        dest = ((route.get("destination") or {}).get("icao_code"))
        if not origin and not dest:
            return None
        return {
            "callsign": route.get("callsign") or key,
            "origin": origin,
            "destination": dest,
        }

    async def _fetch_aircraft(self, key: str) -> Optional[dict]:
        url = f"https://api.adsbdb.com/v0/aircraft/{key}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers={"Accept": "application/json"})
        if resp.status_code == 429:
            raise UpstreamRateLimitedError(_parse_retry_after(resp.headers.get("Retry-After")))
        if resp.status_code in (400, 404):
            return None
        resp.raise_for_status()
        body = resp.json() or {}
        aircraft = ((body.get("response") or {}).get("aircraft") or {})
        if not aircraft:
            return None
        return {
            "registration": aircraft.get("registration"),
            "type": aircraft.get("type"),
            "icao_type": aircraft.get("icao_type"),
            "manufacturer": aircraft.get("manufacturer"),
            "operator": aircraft.get("registered_owner"),
            "operator_country": aircraft.get("registered_owner_country_name"),
            "country_iso": aircraft.get("registered_owner_country_iso_name"),
            "photo_url": aircraft.get("url_photo"),
            "photo_thumbnail": aircraft.get("url_photo_thumbnail"),
        }


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
