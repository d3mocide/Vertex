import asyncio
import logging
import re
from urllib.parse import urlparse

from bus import publish_entity
from config import settings
from enrichment.aprs_symbols import classify_symbol
from .base import BasePoller

logger = logging.getLogger(__name__)

_RETRY_DELAY = 10
_DEFAULT_APRS_HOST = "rotate.aprs2.net"
_DEFAULT_APRS_PORT = 14580

# /A=XXXXXX altitude extension in feet (appears anywhere in the comment field)
_ALT_RE = re.compile(r"/A=(\d{6})")


def _parse_source(url: str) -> tuple[str, int]:
    if "://" in url:
        parsed = urlparse(url)
        host = parsed.hostname or _DEFAULT_APRS_HOST
        port = parsed.port or _DEFAULT_APRS_PORT
        return host, port

    if ":" in url:
        host, port_s = url.rsplit(":", 1)
        try:
            return host.strip(), int(port_s)
        except Exception:
            pass

    return url.strip(), _DEFAULT_APRS_PORT


def _dm_to_deg(dm: str, hemi: str, is_lon: bool) -> float | None:
    try:
        if is_lon:
            deg = int(dm[:3])
            mins = float(dm[3:])
        else:
            deg = int(dm[:2])
            mins = float(dm[2:])
        val = deg + mins / 60.0
        if hemi in ("S", "W"):
            val = -val
        return val
    except Exception:
        return None


def _parse_packet(payload: str) -> dict | None:
    """Parse an APRS position payload.

    Returns a dict with lat, lon, heading, speed, altitude,
    symbol_table, symbol_code, comment — or None if position cannot be decoded.
    """
    if not payload:
        return None

    start: int | None = None
    if payload[0] in ("!", "="):
        start = 1
    elif payload[0] in ("/", "@") and len(payload) > 8:
        start = 8

    if start is None or len(payload) < start + 19:
        return None

    lat_dm = payload[start:start + 7]
    lat_hemi = payload[start + 7]
    symbol_table = payload[start + 8]
    lon_dm = payload[start + 9:start + 17]
    lon_hemi = payload[start + 17]
    symbol_code = payload[start + 18]

    if lat_hemi not in ("N", "S") or lon_hemi not in ("E", "W"):
        return None

    lat = _dm_to_deg(lat_dm, lat_hemi, is_lon=False)
    lon = _dm_to_deg(lon_dm, lon_hemi, is_lon=True)
    if lat is None or lon is None:
        return None

    heading: float | None = None
    speed: float | None = None
    comment_start = start + 19
    idx = start + 19
    if len(payload) >= idx + 7 and payload[idx + 3] == "/":
        c = payload[idx:idx + 3]
        s = payload[idx + 4:idx + 7]
        if c.isdigit():
            heading = float(int(c))
        if s.isdigit():
            speed = float(int(s))
        comment_start = idx + 7

    raw_comment = payload[comment_start:]

    # Extract altitude from /A=XXXXXX (feet) and strip it from the comment
    altitude: float | None = None
    alt_match = _ALT_RE.search(raw_comment)
    if alt_match:
        altitude = float(int(alt_match.group(1)))
        raw_comment = raw_comment[:alt_match.start()] + raw_comment[alt_match.end():]

    comment = raw_comment.strip() or None

    return {
        "lat": lat,
        "lon": lon,
        "heading": heading,
        "speed": speed,
        "altitude": altitude,
        "symbol_table": symbol_table,
        "symbol_code": symbol_code,
        "comment": comment,
    }


class AprsPoller(BasePoller):
    name = "aprs"
    interval = 10

    def __init__(self):
        self._sources: list[tuple[str, int]] = []

    async def poll(self):
        pass

    async def setup(self):
        from db import get_pool

        rows = await get_pool().fetch(
            "SELECT url FROM poller_sources WHERE type = 'aprs' AND enabled = TRUE"
        )
        if rows:
            self._sources = [_parse_source(r["url"]) for r in rows if r.get("url")]
        else:
            self._sources = [(_DEFAULT_APRS_HOST, _DEFAULT_APRS_PORT)]

        logger.info("[aprs] %d APRS source(s) configured", len(self._sources))

    async def run(self):
        await self.setup()
        await asyncio.gather(*[asyncio.create_task(self._run_source(host, port)) for host, port in self._sources])

    async def _run_source(self, host: str, port: int):
        radius = max(10, int(settings.aprs_filter_radius_km))
        login = (
            f"user {settings.aprs_callsign} pass {settings.aprs_passcode} vers Vertex 1.0 "
            f"filter r/{settings.region_lat:.4f}/{settings.region_lon:.4f}/{radius}\n"
        )

        while True:
            try:
                logger.info("[aprs] connecting to %s:%d", host, port)
                reader, writer = await asyncio.open_connection(host, port)
                writer.write(login.encode("utf-8"))
                await writer.drain()

                while True:
                    try:
                        raw = await asyncio.wait_for(reader.readline(), timeout=120)
                    except asyncio.TimeoutError:
                        logger.warning("[aprs] read timeout, reconnecting")
                        break
                    if not raw:
                        break
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line or line.startswith("#") or ":" not in line or ">" not in line:
                        continue

                    header, payload = line.split(":", 1)
                    callsign = header.split(">", 1)[0].strip()
                    # Path is everything after the callsign's '>' in the header
                    path = header.split(">", 1)[1].strip() if ">" in header else None

                    parsed = _parse_packet(payload)
                    if not parsed:
                        continue

                    sym_desc, station_type = classify_symbol(
                        parsed["symbol_table"], parsed["symbol_code"]
                    )

                    identity: dict = {"callsign": callsign}
                    if path:
                        identity["path"] = path
                    identity["symbol"] = f"{parsed['symbol_table']}{parsed['symbol_code']}"
                    if sym_desc:
                        identity["symbol_desc"] = sym_desc
                    if station_type and station_type != "unknown":
                        identity["station_type"] = station_type
                    if parsed["comment"]:
                        identity["comment"] = parsed["comment"]

                    entity: dict = {
                        "entity_id": f"aprs:{callsign}",
                        "entity_type": "aprs",
                        "source": "aprs",
                        "display_name": callsign,
                        "lat": parsed["lat"],
                        "lon": parsed["lon"],
                        "heading": parsed["heading"],
                        "speed": parsed["speed"],
                        "status": "active",
                        "identity": identity,
                        "tags": ["aprs"],
                    }
                    if parsed["altitude"] is not None:
                        entity["altitude"] = parsed["altitude"]

                    await publish_entity(entity, ttl=600)

                writer.close()
                await writer.wait_closed()
            except Exception as exc:
                logger.warning("[aprs] source error (%s:%d): %s", host, port, exc)

            await asyncio.sleep(_RETRY_DELAY)
