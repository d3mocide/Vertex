"""NOAA Weather Radio via Tocsin: status for the Environment page and a server-side audio relay.

The poller (poller/pollers/tocsin.py) keeps the feeds in Redis; this router only reads them. The audio relay
exists because the browser cannot reach Tocsin's private address and must never see its API key.
"""
import json

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from config import settings
from redis_bus import get_redis
from security import send_pinned_http_request

router = APIRouter(prefix="/nwr", tags=["nwr"])


async def _feed(key: str, default):
    raw = await get_redis().get(f"feed:{key}")
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


@router.get("")
async def nwr_status():
    """Is Tocsin configured and reachable, which stream is on air, and the latest spoken broadcast."""
    if not settings.tocsin_url:
        return {"enabled": False}
    status = await _feed("nwr:status", {"reachable": False})
    alerts = await _feed("nwr:alerts", [])
    areas = await _feed("nwr:areas", [])
    streams = [s for s in status.get("streams", []) if s.get("on_air")]
    return {
        "enabled": True,
        **status,
        "alerts": alerts if isinstance(alerts, list) else [],
        "areas": areas if isinstance(areas, list) else [],
        "notices": [n for n in ((await _feed("nwr:broadcast", None)) or {}).get("notices", []) if n.get("active")],
        "stream_url": "/api/v1/nwr/stream" if streams else None,
    }


@router.get("/stream")
async def nwr_stream():
    """Relay the first on-air weather-radio mount from Tocsin's Icecast."""
    if not settings.tocsin_url:
        raise HTTPException(404, "NOAA Weather Radio is not configured")
    status = await _feed("nwr:status", {})
    mount = next((s.get("mount") for s in status.get("streams", []) if s.get("on_air") and s.get("mount")), None)
    if not mount or "/" in mount.strip("/") or ".." in mount:
        raise HTTPException(503, "No weather-radio stream on air")
    url = f"{settings.tocsin_url.rstrip('/')}/stream/{mount.lstrip('/')}"
    headers = {"X-API-Key": settings.tocsin_api_key} if settings.tocsin_api_key else None

    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0), follow_redirects=False)
    try:
        resp = await send_pinned_http_request(client, "GET", url, max_redirects=0, stream=True, headers=headers)
    except (httpx.RequestError, ValueError):
        await client.aclose()
        raise HTTPException(503, "Weather-radio stream unavailable")
    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        raise HTTPException(502, f"Weather-radio stream error: {resp.status_code}")

    async def _iter():
        try:
            async for chunk in resp.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await resp.aclose()

    # X-Accel-Buffering: nginx (and most proxies) must pass a live stream straight through, not collect it.
    return StreamingResponse(_iter(), media_type=resp.headers.get("content-type", "audio/ogg"),
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
                             background=BackgroundTask(client.aclose))


@router.get("/broadcast")
async def nwr_broadcast():
    """What the station has been saying, as data: notices, hourly observations, river gauges (checked against NOAA's
    own readings), marine and zone forecasts. Polled less often than /nwr, which only carries the notices."""
    if not settings.tocsin_url:
        return {"enabled": False}
    data = await _feed("nwr:broadcast", None)
    return {"enabled": True, **(data or {"notices": [], "observations": {"hour": None, "stations": []}, "rivers": [],
                                          "marine": {}, "forecasts": []})}
