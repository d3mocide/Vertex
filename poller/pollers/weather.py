import asyncio
import logging
import httpx
from config import settings
from bus import set_feed
from normalizers.weather import normalize_observation
from .base import BasePoller

logger = logging.getLogger(__name__)

NWS_BASE = "https://api.weather.gov"
AVWX_BASE = "https://aviationweather.gov/api/data"
_HEADERS = {"User-Agent": "Vertex/0.1 (vertex; contact@localhost)"}

# Aviation weather polls less frequently — every 15 min
_AVIATION_INTERVAL = 900
_aviation_tick = 0


class WeatherPoller(BasePoller):
    name = "weather"
    interval = 300  # 5 minutes

    async def setup(self):
        self._airnow_consecutive_failures = 0
        self._aviation_tick = 0

    async def poll(self):
        global _aviation_tick

        obs, aqi = await asyncio.gather(
            self._fetch_observation(),
            self._fetch_aqi(),
            return_exceptions=True,
        )

        payload = obs if isinstance(obs, dict) else {}
        if isinstance(aqi, dict) and aqi:
            payload.update(aqi)

        if payload:
            await set_feed("weather:current", payload)

        # Aviation weather every 15 min (~3 normal poll cycles)
        self._aviation_tick += 1
        if self._aviation_tick >= (_AVIATION_INTERVAL // self.interval):
            self._aviation_tick = 0
            hazards, avobs = await asyncio.gather(
                self._fetch_aviation_hazards(),
                self._fetch_aviation_obs(),
                return_exceptions=True,
            )
            if isinstance(hazards, dict):
                await set_feed("weather:aviation_hazards", hazards)
            if isinstance(avobs, dict):
                await set_feed("weather:aviation_obs", avobs)

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
            
        lat = settings.region_lat
        lon = settings.region_lon
        
        url = "https://www.airnowapi.org/aq/observation/latLong/current/"
        params = {
            "format": "application/json",
            "latitude": lat,
            "longitude": lon,
            "distance": 50,
            "API_KEY": settings.airnow_api_key,
        }
        _success = False
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, list) or not data:
                return {}

            # Find the max AQI across pollutants like PM2.5 and O3
            max_aqi_obs = max(data, key=lambda d: d.get("AQI", -1))
            _success = True
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
            if _success:
                if self._airnow_consecutive_failures > 0:
                    logger.info("[weather] AirNow AQI recovered after %d failures", self._airnow_consecutive_failures)
                self._airnow_consecutive_failures = 0

    async def _fetch_aviation_hazards(self) -> dict:
        """Fetch PIREPs and SIGMETs/AIRMETs from aviationweather.gov."""
        bbox = f"{settings.bbox_min_lat},{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon}"
        pireps, sigmets, airmets = [], [], []
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            try:
                r = await client.get(f"{AVWX_BASE}/pirep", params={"bbox": bbox, "age": "3", "format": "json"})
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        pireps = [
                            {
                                "type": p.get("reportType", "PIREP"),
                                "time": p.get("obsTime") or p.get("receiptTime"),
                                "lat": p.get("lat"),
                                "lon": p.get("lon"),
                                "aircraft": p.get("aircraftRef"),
                                "altitude": p.get("altitude"),
                                "turbulence": p.get("turbIntensity"),
                                "icing": p.get("icgIntensity"),
                                "raw": p.get("rawOb"),
                            }
                            for p in data
                        ]
            except Exception as exc:
                logger.debug("[weather] PIREP fetch failed: %s", exc)

            try:
                r = await client.get(f"{AVWX_BASE}/sigmet", params={"format": "json"})
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        sigmets = [
                            {
                                "type": s.get("airSigmetType", "SIGMET"),
                                "hazard": s.get("hazard"),
                                "severity": s.get("severity"),
                                "valid_from": s.get("validTimeFrom"),
                                "valid_to": s.get("validTimeTo"),
                                "area": s.get("area"),
                                "raw": s.get("rawAirSigmet"),
                            }
                            for s in data
                            if s.get("airSigmetType") == "SIGMET"
                        ]
                        airmets = [
                            {
                                "type": s.get("airSigmetType", "AIRMET"),
                                "hazard": s.get("hazard"),
                                "severity": s.get("severity"),
                                "valid_from": s.get("validTimeFrom"),
                                "valid_to": s.get("validTimeTo"),
                                "area": s.get("area"),
                                "raw": s.get("rawAirSigmet"),
                            }
                            for s in data
                            if s.get("airSigmetType") == "AIRMET"
                        ]
            except Exception as exc:
                logger.debug("[weather] SIGMET/AIRMET fetch failed: %s", exc)

        return {"pireps": pireps, "sigmets": sigmets, "airmets": airmets}

    async def _fetch_aviation_obs(self) -> dict:
        """Fetch nearby METARs and TAFs from aviationweather.gov."""
        bbox = f"{settings.bbox_min_lat},{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon}"
        metars, tafs = [], []
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            try:
                r = await client.get(
                    f"{AVWX_BASE}/metar",
                    params={"bbox": bbox, "format": "json", "hours": "2"},
                )
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        metars = [
                            {
                                "station": m.get("stationId"),
                                "time": m.get("reportTime") or m.get("obsTime"),
                                "temp_c": m.get("temp"),
                                "dewpoint_c": m.get("dewp"),
                                "wind_dir": m.get("wdir"),
                                "wind_kt": m.get("wspd"),
                                "gust_kt": m.get("wgst"),
                                "visibility_sm": m.get("visib"),
                                "altimeter": m.get("altim"),
                                "flight_category": m.get("fltcat"),
                                "raw": m.get("rawOb"),
                            }
                            for m in data
                        ]
            except Exception as exc:
                logger.debug("[weather] METAR fetch failed: %s", exc)

            try:
                r = await client.get(
                    f"{AVWX_BASE}/taf",
                    params={"bbox": bbox, "format": "json"},
                )
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        tafs = [
                            {
                                "station": t.get("stationId"),
                                "issue_time": t.get("issueTime"),
                                "valid_from": t.get("validTimeFrom"),
                                "valid_to": t.get("validTimeTo"),
                                "raw": t.get("rawTAF"),
                            }
                            for t in data
                        ]
            except Exception as exc:
                logger.debug("[weather] TAF fetch failed: %s", exc)

        return {"metars": metars, "tafs": tafs}

