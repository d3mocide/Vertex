"""
TinyGS poller — polls the public TinyGS community REST API.

No authentication required. Publishes all public ground stations as
`tinygs_station` entities so they appear on the situational-awareness map.

The previous MQTT-based implementation required a physical LoRa ground station,
Telegram-issued credentials, and a private-CA TLS chain that could not be
verified by the default system store.  The public REST API avoids all of that.

Endpoint: https://api.tinygs.com/v1/stations
Interval: every 5 minutes (station data updates infrequently)
"""

import logging
import time

import httpx

from bus import publish_entity
from .base import BasePoller

logger = logging.getLogger(__name__)

_STATIONS_URL = "https://api.tinygs.com/v1/stations"
_STATION_TTL  = 600   # entities expire after 10 min if not re-polled


class TinyGSPoller(BasePoller):
    name     = "tinygs"
    interval = 300   # seconds between polls

    async def poll(self):
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            await self._poll_stations(client)

    async def _poll_stations(self, client: httpx.AsyncClient) -> None:
        try:
            resp = await client.get(_STATIONS_URL)
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("[tinygs] station fetch failed: %s", exc)
            return

        try:
            data = resp.json()
        except Exception as exc:
            logger.warning("[tinygs] could not parse response: %s", exc)
            return

        # API may return a bare list or {"stations": [...]}
        stations: list = data if isinstance(data, list) else data.get("stations", [])
        if not isinstance(stations, list):
            logger.warning("[tinygs] unexpected response shape")
            return

        published = 0
        for stn in stations:
            if not isinstance(stn, dict):
                continue

            name = stn.get("name") or stn.get("stationName") or ""
            if not name:
                continue

            lat = stn.get("lat") or stn.get("latitude")
            lon = stn.get("lng") or stn.get("lon") or stn.get("longitude")
            if lat is None or lon is None:
                continue

            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue

            # Stations that heard a packet in the last hour count as "online"
            last_ts = stn.get("lastPacketTime") or stn.get("lastSeen") or 0
            try:
                last_ts_f = float(last_ts)
            except (TypeError, ValueError):
                last_ts_f = 0.0
            is_online = last_ts_f > 0 and (time.time() - last_ts_f) < 3600

            entity = {
                "entity_id":    f"tinygs:station:{name}",
                "entity_type":  "tinygs_station",
                "source":       "tinygs",
                "display_name": name,
                "lat":          lat,
                "lon":          lon,
                "status":       "online" if is_online else "offline",
                "identity": {
                    "station_name":      name,
                    "total_packets":     stn.get("totalPackets"),
                    "confirmed_packets": stn.get("confirmed"),
                    "last_active_ts":    last_ts or None,
                },
                "tags": ["tinygs", "ground_station"],
            }
            await publish_entity(entity, ttl=_STATION_TTL)
            published += 1

        logger.info("[tinygs] published %d stations", published)
