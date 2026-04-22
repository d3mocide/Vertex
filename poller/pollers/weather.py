import asyncio
import logging
import httpx
from config import settings
from bus import set_feed
from normalizers.weather import normalize_observation, normalize_alerts
from .base import BasePoller

logger = logging.getLogger(__name__)

NWS_BASE = "https://api.weather.gov"
_HEADERS = {"User-Agent": "CivicGrid/0.1 (civic-grid; contact@localhost)"}


class WeatherPoller(BasePoller):
    name = "weather"
    interval = 300  # 5 minutes

    async def setup(self):
        self._airnow_consecutive_failures = 0

    async def poll(self):
        obs, aqi, _ = await asyncio.gather(
            self._fetch_observation(),
            self._fetch_aqi(),
            self._poll_alerts(),
            return_exceptions=True
        )
        
        payload = obs if isinstance(obs, dict) else {}
        if isinstance(aqi, dict) and aqi:
            payload.update(aqi)
            
        if payload:
            await set_feed("weather:current", payload)

    async def _fetch_observation(self) -> dict:
        url = f"{NWS_BASE}/stations/{settings.nws_station_primary}/observations/latest"
        try:
            async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            return normalize_observation(resp.json())
        except Exception as exc:
            logger.warning("[weather] NWS observation failed: %s", exc)
            return {}

    async def _fetch_aqi(self) -> dict:
        if not settings.airnow_api_key:
            return {}
            
        lat = (settings.bbox_max_lat + settings.bbox_min_lat) / 2.0
        lon = (settings.bbox_max_lon + settings.bbox_min_lon) / 2.0
        
        url = "https://www.airnowapi.org/aq/observation/latLong/current/"
        params = {
            "format": "application/json",
            "latitude": lat,
            "longitude": lon,
            "distance": 25,
            "API_KEY": settings.airnow_api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, list) or not data:
                return {}
            
            # Find the max AQI across pollutants like PM2.5 and O3
            max_aqi_obs = max(data, key=lambda d: d.get("AQI", -1))
            return {
                "aqi": max_aqi_obs.get("AQI"),
                "aqi_label": max_aqi_obs.get("Category", {}).get("Name"),
            }
        except httpx.HTTPStatusError as exc:
            self._airnow_consecutive_failures += 1
            status = exc.response.status_code
            if status >= 500:
                # AirNow intermittently returns 5xx; keep weather feed flowing without noisy warnings.
                if self._airnow_consecutive_failures in (1, 6):
                    logger.info("[weather] AirNow AQI temporarily unavailable (HTTP %d)", status)
                else:
                    logger.debug("[weather] AirNow AQI still unavailable (HTTP %d)", status)
            else:
                if self._airnow_consecutive_failures in (1, 3):
                    logger.warning("[weather] AirNow AQI request failed with HTTP %d", status)
                else:
                    logger.debug("[weather] AirNow AQI request still failing with HTTP %d", status)
            return {}
        except httpx.HTTPError as exc:
            self._airnow_consecutive_failures += 1
            if self._airnow_consecutive_failures in (1, 6):
                logger.info("[weather] AirNow AQI request failed (%s)", exc.__class__.__name__)
            else:
                logger.debug("[weather] AirNow AQI request still failing (%s)", exc.__class__.__name__)
            return {}
        except Exception as exc:
            self._airnow_consecutive_failures += 1
            if self._airnow_consecutive_failures in (1, 3):
                logger.warning("[weather] AirNow AQI unexpected failure (%s)", exc.__class__.__name__)
            else:
                logger.debug("[weather] AirNow AQI unexpected failure (%s)", exc.__class__.__name__)
            return {}
        finally:
            # Reset only on success path where data parsing completed with no exception.
            if "data" in locals():
                if self._airnow_consecutive_failures > 0:
                    logger.info("[weather] AirNow AQI recovered after %d failures", self._airnow_consecutive_failures)
                self._airnow_consecutive_failures = 0

    async def _poll_alerts(self):
        url = f"{NWS_BASE}/alerts/active?zone={settings.nws_zone}"
        try:
            async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
                resp = await client.get(url)
                resp.raise_for_status()
            await set_feed("weather:alerts", normalize_alerts(resp.json()))
        except Exception as exc:
            logger.warning("[weather] NWS alerts failed: %s", exc)
            await set_feed("weather:alerts", [])
