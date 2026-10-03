"""Elevation tiles for the 3D map, fetched once by the backend and served from memory afterwards.

The map engine asks for these without auth headers (like the weather WMS tiles), so the route is public and read-only;
the tiles are public-domain elevation data. Serving them here keeps the browser from contacting a third party, lets the
operator point `TERRAIN_TILE_URL` at their own tile server, and means each tile is fetched upstream once.
"""
import asyncio
from collections import OrderedDict

import httpx
from fastapi import APIRouter, Path, Response

from config import settings

router = APIRouter(prefix="/terrain", tags=["terrain"])

MAX_ZOOM = 15
CACHE_TILES = 512            # about 40 KB each: tens of MB at most
BROWSER_MAX_AGE = 7 * 24 * 3600
_UPSTREAM_TIMEOUT = 15.0

_cache: "OrderedDict[tuple[int, int, int], bytes]" = OrderedDict()
_inflight: dict[tuple[int, int, int], "asyncio.Future[bytes | None]"] = {}
_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_UPSTREAM_TIMEOUT, follow_redirects=True)
    return _client


async def _fetch(z: int, x: int, y: int) -> bytes | None:
    """The tile from upstream, or None when it does not exist or cannot be fetched."""
    url = settings.terrain_tile_url.format(z=z, x=x, y=y)
    try:
        resp = await _http().get(url)
    except httpx.HTTPError:
        return None
    if resp.status_code != 200 or not resp.content:
        return None
    return resp.content


async def get_tile(z: int, x: int, y: int) -> bytes | None:
    key = (z, x, y)
    hit = _cache.get(key)
    if hit is not None:
        _cache.move_to_end(key)
        return hit
    pending = _inflight.get(key)
    if pending is not None:             # many requests for one new tile share a single upstream fetch
        return await pending
    future: "asyncio.Future[bytes | None]" = asyncio.get_running_loop().create_future()
    _inflight[key] = future
    try:
        tile = await _fetch(z, x, y)
        if tile is not None:
            _cache[key] = tile
            while len(_cache) > CACHE_TILES:
                _cache.popitem(last=False)
        future.set_result(tile)
        return tile
    except BaseException as exc:
        future.set_exception(exc)
        future.exception()              # mark retrieved: nobody may be awaiting it
        raise
    finally:
        _inflight.pop(key, None)


@router.get("/dem/{z}/{x}/{y}.png")
async def dem_tile(
    z: int = Path(ge=0, le=MAX_ZOOM),
    x: int = Path(ge=0),
    y: int = Path(ge=0),
):
    if x >= 1 << z or y >= 1 << z:
        return Response(status_code=404)
    tile = await get_tile(z, x, y)
    if tile is None:
        return Response(status_code=404)
    return Response(
        content=tile,
        media_type="image/png",
        headers={"Cache-Control": f"public, max-age={BROWSER_MAX_AGE}, immutable"},
    )
