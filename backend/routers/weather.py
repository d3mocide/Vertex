import json
import struct
import zlib

import httpx
from fastapi import APIRouter, Request, Response
from redis_bus import get_redis

router = APIRouter(prefix="/weather", tags=["weather"])

SMOKE_WMS_URL = (
    "https://maps.ncei.noaa.gov/arcgis/rest/services/nowCoast_Visible_Imagery/MapServer/WmsServer"
)

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
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            upstream = await client.get(SMOKE_WMS_URL, params=request.query_params)
    except Exception:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    if upstream.status_code != 200:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    content_type = upstream.headers.get("content-type", "image/png")
    return Response(content=upstream.content, media_type=content_type)


# NOAA GOES-East satellite imagery via nowCOAST ArcGIS WMS
GOES_WMS_URL = (
    "https://nowcoast.noaa.gov/arcgis/rest/services"
    "/nowcoast/sat_meteo_imagery_time/MapServer/WmsServer"
)


@router.get("/goes/wms")
async def proxy_goes_wms(request: Request):
    """Proxy NOAA GOES satellite WMS tiles to avoid browser CORS issues."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            upstream = await client.get(GOES_WMS_URL, params=request.query_params)
    except Exception:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    if upstream.status_code != 200:
        return Response(content=TRANSPARENT_PNG, media_type="image/png")

    content_type = upstream.headers.get("content-type", "image/png")
    return Response(content=upstream.content, media_type=content_type)


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
