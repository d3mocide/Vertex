"""DebouncedCacheSaver writes only after a real change, at most once per interval; MetarClient caches batch results."""
from __future__ import annotations

import gzip
import json
import os
import sys
from unittest.mock import MagicMock

import pytest

_POLLER_ROOT = os.path.join(os.path.dirname(__file__), "..")
if _POLLER_ROOT not in sys.path:
    sys.path.insert(0, _POLLER_ROOT)


@pytest.fixture
def enrichment(tmp_path, monkeypatch):
    """Fresh, real enrichment modules: other test modules leave mocks for `enrichment.*` and `config` in sys.modules,
    so a plain import could return a mock depending on test order. monkeypatch restores whatever was there."""
    settings = MagicMock()
    settings.adsb_enrichment_cache_dir = str(tmp_path)
    monkeypatch.setitem(sys.modules, "config", MagicMock(settings=settings))
    for name in ("enrichment", "enrichment.cache", "enrichment.metar"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    import enrichment.cache
    import enrichment.metar
    return enrichment


def _lookup(enrichment):
    cache = enrichment.cache
    return cache.CachedLookup(positive_ttl_seconds=3600, negative_ttl_seconds=60, max_size=100,
                              throttle=cache.HttpThrottle(min_interval_seconds=0, default_cooldown_seconds=0))


def _read(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def test_saves_only_after_a_change_and_once_per_interval(enrichment, tmp_path):
    path = str(tmp_path / "c.json.gz")
    lk = _lookup(enrichment)
    saver = enrichment.cache.DebouncedCacheSaver(path, lambda: {"entries": lk.export_entries()}, [lk], min_interval=300)

    saver.flush()                                   # nothing changed yet
    assert not os.path.exists(path)

    lk.store("a", {"x": 1})
    assert not saver.maybe_save(now=saver._last_save + 10)    # changed, but inside the interval
    assert saver.maybe_save(now=saver._last_save + 301)        # no running loop: written synchronously
    assert _read(path)["entries"]["a"]["data"] == {"x": 1}

    lk.lookup_cached("a")                           # a cache hit is not a change
    assert not saver.dirty
    assert not saver.maybe_save(now=saver._last_save + 10_000)


@pytest.mark.asyncio
async def test_hits_do_not_save_and_fetches_save_in_background(enrichment, tmp_path):
    path = str(tmp_path / "c.json.gz")
    lk = _lookup(enrichment)
    saver = enrichment.cache.DebouncedCacheSaver(path, lambda: {"entries": lk.export_entries()}, [lk], min_interval=0)

    async def fetch(key):
        return {"key": key}

    await lk.get("k1", fetch)
    assert saver.maybe_save()
    await saver._writing
    assert "k1" in _read(path)["entries"]

    mtime = os.stat(path).st_mtime_ns
    await lk.get("k1", fetch)                       # served from the cache
    assert not saver.maybe_save()
    assert os.stat(path).st_mtime_ns == mtime


@pytest.mark.asyncio
async def test_metar_batch_results_are_cached(enrichment, tmp_path):
    client = enrichment.metar.MetarClient()
    calls = []

    async def fake_batch(keys):
        calls.append(list(keys))
        return {k: ({"raw": k} if k == "KPDX" else None) for k in keys}

    client._fetch_batch = fake_batch
    first = await client.lookup_many(["KPDX", "KXYZ"])
    assert first == {"KPDX": {"raw": "KPDX"}, "KXYZ": None}
    again = await client.lookup_many(["KPDX", "KXYZ"])
    assert again == first
    assert calls == [["KPDX", "KXYZ"]]              # the second call came from the cache
    client.flush()
    assert set(_read(os.path.join(str(tmp_path), "metar.json.gz"))["entries"]) == {"KPDX", "KXYZ"}
