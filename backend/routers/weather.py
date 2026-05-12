import json
import struct
import zlib

import httpx
from fastapi import APIRouter, Request, Response
from redis_bus import get_redis

router = APIRouter(prefix="/weather", tags=["weather"])

SMOKE_WMS_URL = (
    "https://nowcoast.noaa.gov/geoserver/observations/satellite/wms"
)
GOES_WMS_URL = "https://nowcoast.noaa.gov/geoserver/satellite/wms"
GEOSERVER_WMS_URL = "https://nowcoast.noaa.gov/geoserver/wms"

WMS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _make_transparent_png() -> bytes:
    # Valid 1x1 RGBA transparent PNG with correct chunk CRCs.
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)  # RGBA, no interlace
    raw_scanline = b"\x00\x00\x00\x00\x00"  # filter byte + one transparent pixel
    idat_data = zlib.compress(raw_scanline, level=9)
    return (
        signature
        + _png_chunk(b"IHDR", ihdr_data)
        + _png_chunk(b"IDAT", idat_data)
        + _png_chunk(b"IEND", b"")
    )


# 1x1 transparent PNG fallback returned when upstream tiles fail.
TRANSPARENT_PNG = _make_transparent_png()


async def _proxy_wms(url: str, params: dict):
    """Internal helper to proxy WMS requests with proper headers and error handling."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            upstream = await client.get(url, params=params, headers=WMS_HEADERS)
    except Exception:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    if upstream.status_code != 200:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    content_type = upstream.headers.get("content-type", "image/png")
    return Response(content=upstream.content, media_type=content_type)


@router.get("")
async def get_weather():
    raw = await get_redis().get("feed:weather:current")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


@router.get("/alerts")
async def get_weather_alerts():
    raw = await get_redis().get("feed:weather:alerts")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


@router.get("/aviation/hazards")
async def get_aviation_hazards():
    """PIREPs, SIGMETs, and AIRMETs cached from aviationweather.gov."""
    raw = await get_redis().get("feed:weather:aviation_hazards")
    if not raw:
        return {"pireps": [], "sigmets": [], "airmets": []}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"pireps": [], "sigmets": [], "airmets": []}


@router.get("/aviation/obs")
async def get_aviation_obs():
    """Nearby METARs and TAFs cached from aviationweather.gov."""
    raw = await get_redis().get("feed:weather:aviation_obs")
    if not raw:
        return {"metars": [], "tafs": []}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"metars": [], "tafs": []}


@router.get("/smoke/wms")
async def proxy_smoke_wms(request: Request):
    # Proxy NOAA smoke WMS tiles through backend to avoid browser CORS failures.
    return await _proxy_wms(SMOKE_WMS_URL, request.query_params)


@router.get("/goes/wms")
async def proxy_goes_wms(request: Request):
    """Proxy NOAA GOES satellite WMS tiles to avoid browser CORS issues."""
    return await _proxy_wms(GOES_WMS_URL, request.query_params)


@router.get("/radar/wms")
async def proxy_radar_wms(request: Request):
    """Proxy NOAA nowCOAST Base Reflectivity mosaic tiles."""
    return await _proxy_wms(GEOSERVER_WMS_URL, request.query_params)


@router.get("/alerts/wms")
async def proxy_alerts_wms(request: Request):
    """Proxy NOAA nowCOAST Watches/Warnings/Advisories overlay."""
    return await _proxy_wms(GEOSERVER_WMS_URL, request.query_params)


@router.get("/lightning/wms")
async def proxy_lightning_wms(request: Request):
    """Proxy NOAA nowCOAST Lightning Strike Density tiles."""
    return await _proxy_wms(GEOSERVER_WMS_URL, request.query_params)


@router.get("/fire/perimeters")
async def get_fire_perimeters():
    """Active fire perimeters from NIFC WFIGS (cached by poller)."""
    raw = await get_redis().get("feed:fire:perimeters")
    if not raw:
        return {"type": "FeatureCollection", "features": []}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"type": "FeatureCollection", "features": []}


@router.get("/nwws")
async def get_nwws_products():
    """Recent NWS text products (AFD, HWO, LSR) from the local forecast office."""
    raw = await get_redis().get("feed:weather:nwws_products")
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


@router.get("/pws")
async def get_pws_observation():
    """Current Personal Weather Station observation from Weather Underground."""
    raw = await get_redis().get("feed:weather:pws")
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
