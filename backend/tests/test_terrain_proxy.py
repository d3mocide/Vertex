"""The elevation-tile proxy: validation, caching, shared fetches, and failure handling."""
import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import terrain

PNG = b"\x89PNG\r\n\x1a\nfake-tile"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    terrain._cache.clear()
    terrain._inflight.clear()
    monkeypatch.setattr(terrain, "settings", SimpleNamespace(terrain_tile_url="https://tiles.example/{z}/{x}/{y}.png"))
    calls = []

    async def fake_fetch(z, x, y):
        calls.append((z, x, y))
        await asyncio.sleep(0)
        return PNG if x != 1 else None

    monkeypatch.setattr(terrain, "_fetch", fake_fetch)
    return calls


def client():
    app = FastAPI()
    app.include_router(terrain.router, prefix="/api/v1")
    return TestClient(app)


def test_tile_is_served_with_long_cache_headers_and_fetched_once(fresh):
    c = client()
    r = c.get("/api/v1/terrain/dem/10/164/357.png")
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"] == "image/png"
    assert "max-age" in r.headers["cache-control"] and "immutable" in r.headers["cache-control"]
    assert c.get("/api/v1/terrain/dem/10/164/357.png").content == PNG
    assert fresh == [(10, 164, 357)]


def test_out_of_range_tiles_are_rejected_without_an_upstream_call(fresh):
    c = client()
    assert c.get("/api/v1/terrain/dem/16/0/0.png").status_code == 422      # past max zoom
    assert c.get("/api/v1/terrain/dem/3/8/0.png").status_code == 404       # x beyond 2^z
    assert c.get("/api/v1/terrain/dem/3/0/8.png").status_code == 404
    assert c.get("/api/v1/terrain/dem/3/-1/0.png").status_code == 422
    assert fresh == []


def test_missing_upstream_tile_is_404_and_not_cached(fresh):
    c = client()
    assert c.get("/api/v1/terrain/dem/5/1/2.png").status_code == 404
    assert c.get("/api/v1/terrain/dem/5/1/2.png").status_code == 404
    assert len(fresh) == 2 and not terrain._cache


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_upstream_fetch(fresh):
    results = await asyncio.gather(*[terrain.get_tile(8, 40, 90) for _ in range(5)])
    assert results == [PNG] * 5
    assert fresh == [(8, 40, 90)]


@pytest.mark.asyncio
async def test_cache_is_bounded(monkeypatch, fresh):
    monkeypatch.setattr(terrain, "CACHE_TILES", 3)
    for x in range(2, 8):
        await terrain.get_tile(6, x, 0)
    assert len(terrain._cache) == 3 and (6, 7, 0) in terrain._cache and (6, 2, 0) not in terrain._cache


@pytest.mark.asyncio
async def test_upstream_errors_become_a_miss(monkeypatch):
    class Boom:
        async def get(self, url):
            raise httpx.ConnectError("down")

    monkeypatch.undo()
    monkeypatch.setattr(terrain, "settings", SimpleNamespace(terrain_tile_url="https://tiles.example/{z}/{x}/{y}.png"))
    monkeypatch.setattr(terrain, "_http", lambda: Boom())
    assert await terrain.get_tile(4, 1, 1) is None


def _public_prefixes():
    """Read the tuple from the source: several other test modules replace `auth_middleware` with a stub."""
    import ast
    from pathlib import Path
    tree = ast.parse((Path(__file__).resolve().parents[1] / "auth_middleware.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "_PUBLIC_PREFIXES" for t in node.targets):
            return tuple(ast.literal_eval(node.value))
    raise AssertionError("_PUBLIC_PREFIXES not found")


def test_the_tile_route_is_public_but_nothing_else_under_terrain_is():
    prefixes = _public_prefixes()
    assert "/api/v1/terrain/dem/10/1/2.png".startswith(prefixes)
    assert not "/api/v1/terrain".startswith(prefixes)
    assert not "/api/v1/terrain/other".startswith(prefixes)
