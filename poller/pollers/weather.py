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
        # Trigger aviation weather fetch on the first poll cycle
        self._aviation_tick = 999

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
        """Fetch PIREPs and SIGMETs/AIRMETs from aviationweather.gov for all regions."""
        # Use regions if configured, else fallback to settings bbox
        regions = settings.regions or [None]
        
        all_pireps = {}
        all_sigmets = {}
        all_airmets = {}

        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            for region in regions:
                if region:
                    b = region.bbox
                    bbox = f"{b.min_lat},{b.min_lon},{b.max_lat},{b.max_lon}"
                else:
                    bbox = f"{settings.bbox_min_lat},{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon}"

                try:
                    r = await client.get(f"{AVWX_BASE}/pirep", params={"bbox": bbox, "age": "3", "format": "json"})
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list):
                            for p in data:
                                # Deduplicate by raw observation
                                raw = p.get("rawOb")
                                if raw and raw not in all_pireps:
                                    all_pireps[raw] = {
                                        "type": p.get("reportType", "PIREP"),
                                        "time": p.get("obsTime") or p.get("receiptTime"),
                                        "lat": p.get("lat"),
                                        "lon": p.get("lon"),
                                        "aircraft": p.get("aircraftRef"),
                                        "altitude": p.get("altitude"),
                                        "turbulence": p.get("turbIntensity"),
                                        "icing": p.get("icgIntensity"),
                                        "raw": raw,
                                    }
                except Exception as exc:
                    logger.debug("[weather] PIREP fetch failed for region %s: %s", region.id if region else "default", exc)

            # Global/CONUS-wide SIGMETs/AIRMETs (don't need bbox usually, or just fetch once)
            try:
                r = await client.get(f"{AVWX_BASE}/sigmet", params={"format": "json"})
                if r.status_code == 200:
                    data = r.json()
                    if isinstance(data, list):
                        for s in data:
                            raw = s.get("rawAirSigmet")
                            if not raw: continue
                            entry = {
                                "type": s.get("airSigmetType"),
                                "hazard": s.get("hazard"),
                                "severity": s.get("severity"),
                                "valid_from": s.get("validTimeFrom"),
                                "valid_to": s.get("validTimeTo"),
                                "raw": raw,
                            }
                            if s.get("airSigmetType") == "SIGMET":
                                all_sigmets[raw] = entry
                            else:
                                all_airmets[raw] = entry
            except Exception as exc:
                logger.debug("[weather] SIGMET/AIRMET fetch failed: %s", exc)

        return {
            "pireps": list(all_pireps.values()),
            "sigmets": list(all_sigmets.values()),
            "airmets": list(all_airmets.values())
        }

    async def _fetch_aviation_obs(self) -> dict:
        """Fetch METARs and TAFs for all regions."""
        regions = settings.regions or [None]
        all_metars = {}
        all_tafs = {}

        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
            for region in regions:
                if region:
                    b = region.bbox
                    bbox = f"{b.min_lat},{b.min_lon},{b.max_lat},{b.max_lon}"
                else:
                    bbox = f"{settings.bbox_min_lat},{settings.bbox_min_lon},{settings.bbox_max_lat},{settings.bbox_max_lon}"

                try:
                    r = await client.get(
                        f"{AVWX_BASE}/metar",
                        params={"bbox": bbox, "format": "json", "hours": "2"},
                    )
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list):
                            for m in data:
                                # Try multiple possible keys for station ID
                                icao = m.get("icaoId") or m.get("stationId") or m.get("id")
                                
                                # Fallback: Parse from raw observation (e.g., "METAR KSLE ...")
                                raw = m.get("rawOb")
                                if not icao and raw:
                                    parts = raw.split()
                                    if len(parts) > 1:
                                        icao = parts[1] # Usually the second part of a METAR

                                if icao and icao not in all_metars:
                                    all_metars[icao] = {
                                        "station": icao,
                                        "time": m.get("reportTime") or m.get("obsTime"),
                                        "temp_c": m.get("temp"),
                                        "dewpoint_c": m.get("dewp"),
                                        "wind_dir": m.get("wdir"),
                                        "wind_kt": m.get("wspd"),
                                        "gust_kt": m.get("wgst"),
                                        "visibility_sm": m.get("visib"),
                                        "altimeter": m.get("altim"),
                                        "flight_category": m.get("fltCat"),
                                        "raw": raw,
                                    }
                except Exception as exc:
                    logger.debug("[weather] METAR fetch failed for region %s: %s", region.id if region else "default", exc)

                try:
                    r = await client.get(
                        f"{AVWX_BASE}/taf",
                        params={"bbox": bbox, "format": "json"},
                    )
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, list):
                            for t in data:
                                # Try multiple possible keys for station ID
                                icao = t.get("icaoId") or t.get("stationId") or t.get("id")
                                
                                # Fallback: Parse from raw TAF (e.g., "TAF KSLE ...")
                                raw = t.get("rawTAF")
                                if not icao and raw:
                                    parts = raw.split()
                                    if len(parts) > 1:
                                        icao = parts[1]

                                if icao and icao not in all_tafs:
                                    all_tafs[icao] = {
                                        "station": icao,
                                        "issue_time": t.get("issueTime"),
                                        "valid_from": t.get("validTimeFrom"),
                                        "valid_to": t.get("validTimeTo"),
                                        "raw": raw,
                                    }
                except Exception as exc:
                    logger.debug("[weather] TAF fetch failed for region %s: %s", region.id if region else "default", exc)

        return {"metars": list(all_metars.values()), "tafs": list(all_tafs.values())}

