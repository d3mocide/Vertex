from __future__ import annotations

import asyncio
import gzip
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, TypeVar

T = TypeVar("T")

logger = logging.getLogger(__name__)


class UpstreamRateLimitedError(Exception):
    def __init__(self, retry_after_seconds: float | None = None):
        super().__init__("upstream rate limited")
        self.retry_after_seconds = retry_after_seconds


@dataclass
class CacheEntry(Generic[T]):
    data: T | None
    expires_at: float

    def is_fresh(self, now: float) -> bool:
        return now < self.expires_at


class HttpThrottle:
    def __init__(self, min_interval_seconds: float, default_cooldown_seconds: float):
        self._min_interval = min_interval_seconds
        self._default_cooldown = default_cooldown_seconds
        self._lock = asyncio.Lock()
        self._last_request = 0.0
        self._cooldown_until = 0.0

    async def wait_turn(self):
        async with self._lock:
            now = time.time()
            if now < self._cooldown_until:
                await asyncio.sleep(self._cooldown_until - now)

            gap = self._last_request + self._min_interval - time.time()
            if gap > 0:
                await asyncio.sleep(gap)

            self._last_request = time.time()

    def record_cooldown(self, seconds: float | None = None):
        wait = seconds if seconds is not None else self._default_cooldown
        self._cooldown_until = max(self._cooldown_until, time.time() + max(0.0, wait))


class CachedLookup(Generic[T]):
    def __init__(
        self,
        *,
        positive_ttl_seconds: float,
        negative_ttl_seconds: float,
        max_size: int,
        throttle: HttpThrottle,
    ):
        self._positive_ttl = positive_ttl_seconds
        self._negative_ttl = negative_ttl_seconds
        self._max_size = max_size
        self._throttle = throttle
        self._entries: dict[str, CacheEntry[T]] = {}
        self._inflight: dict[str, asyncio.Task[T | None]] = {}

    def export_entries(self) -> dict[str, dict]:
        now = time.time()
        result: dict[str, dict] = {}
        for key, entry in self._entries.items():
            if entry.is_fresh(now):
                result[key] = {
                    "data": entry.data,
                    "expires_at": entry.expires_at,
                }
        return result

    def import_entries(self, payload: dict | None):
        if not isinstance(payload, dict):
            return

        now = time.time()
        for key, raw in payload.items():
            if not isinstance(key, str) or not isinstance(raw, dict):
                continue
            expires_at = raw.get("expires_at")
            if not isinstance(expires_at, (int, float)):
                continue
            if float(expires_at) <= now:
                continue
            self._entries[key] = CacheEntry(data=raw.get("data"), expires_at=float(expires_at))

    def lookup_cached(self, key: str) -> tuple[bool, T | None]:
        entry = self._entries.get(key)
        now = time.time()
        if entry and entry.is_fresh(now):
            return True, entry.data
        return False, None

    def get_stale(self, key: str) -> T | None:
        entry = self._entries.get(key)
        return entry.data if entry else None

    async def get(self, key: str, fetcher: Callable[[str], Awaitable[T | None]]) -> T | None:
        known, cached = self.lookup_cached(key)
        if known:
            return cached

        task = self._inflight.get(key)
        if task is None:
            task = asyncio.create_task(self._fetch_and_cache(key, fetcher))
            self._inflight[key] = task

        try:
            return await task
        finally:
            self._inflight.pop(key, None)

    async def _fetch_and_cache(self, key: str, fetcher: Callable[[str], Awaitable[T | None]]) -> T | None:
        stale_fallback = self.get_stale(key)
        await self._throttle.wait_turn()

        try:
            value = await fetcher(key)
        except UpstreamRateLimitedError as exc:
            self._throttle.record_cooldown(exc.retry_after_seconds)
            logger.warning("[enrichment] rate-limited for %s; serving stale if available", key)
            if stale_fallback is not None:
                return stale_fallback
            self._entries[key] = CacheEntry(data=None, expires_at=time.time() + self._negative_ttl)
            return None
        except Exception as exc:
            logger.warning("[enrichment] fetch failed for %s: %s", key, exc)
            if stale_fallback is not None:
                return stale_fallback
            self._entries[key] = CacheEntry(data=None, expires_at=time.time() + self._negative_ttl)
            return None

        ttl = self._positive_ttl if value is not None else self._negative_ttl
        self._entries[key] = CacheEntry(data=value, expires_at=time.time() + ttl)

        if len(self._entries) > self._max_size:
            self._prune_expired()

        return value

    def _prune_expired(self):
        now = time.time()
        self._entries = {k: v for k, v in self._entries.items() if v.is_fresh(now)}


def save_gzip_json(path: str, payload: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp_path = f"{path}.tmp"
    with gzip.open(temp_path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh)
    os.replace(temp_path, path)


def load_gzip_json(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        logger.warning("[enrichment] failed to load cache %s: %s", path, exc)
        return None
