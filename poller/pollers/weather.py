import asyncio
import logging
import time
import httpx
from config import settings
from security import validate_request_url
from bus import set_feed
from db import latest_weather_aqi, write_weather_obs
from normalizers.weather import normalize_observation
from .base import BasePoller

logger = logging.getLogger(__name__)

NWS_BASE = "https://api.weather.gov"
_HEADERS = {"User-Agent": "Vertex/0.1 (vertex; contact@localhost)"}
_AQI_KEEP_S = 3 * 3600   # how long the last good AirNow reading stands in for a failed one


class WeatherPoller(BasePoller):
    name = "weather"
    interval = 300  # 5 minutes

    async def setup(self):
        self._airnow_consecutive_failures = 0
        self._station_meta: dict[str, dict] = {}
        self._last_aqi: tuple[dict, float] | None = None
        stored = await latest_weather_aqi(_AQI_KEEP_S / 3600)
        if stored:
            self._last_aqi = (stored, time.monotonic())
        # Trigger NWWS fetch on first cycle
        self._nwws_tick = 999

    async def poll(self):
        obs, aqi = await asyncio.gather(
            self._fetch_observation(),
            self._fetch_aqi(),
            return_exceptions=True,
        )

        payload = obs if isinstance(obs, dict) else {}
        if isinstance(aqi, dict) and aqi:
            self._last_aqi = (aqi, time.monotonic())
        elif self._last_aqi and time.monotonic() - self._last_aqi[1] < _AQI_KEEP_S:
            # AirNow often 5xx's for a while and this feed is rewritten whole every
            # poll — without this the AQI tile went blank. It updates hourly, so a
            # recent reading is still the right one to show.
            aqi = self._last_aqi[0]
        if isinstance(aqi, dict) and aqi:
            payload.update(aqi)

        if payload:
            await set_feed("weather:current", payload)
            # History for baselines (the feed above only holds the latest reading).
            try:
                await write_weather_obs(payload)
            except Exception as exc:
                logger.warning("[weather] could not persist observation: %s", exc)

        stations = await self._fetch_stations()
        if stations:
            await set_feed("weather:stations", stations)
            for st in stations:
                try:
                    await write_weather_obs(st)
                except Exception as exc:
                    logger.debug("[weather] could not persist %s: %s", st.get("id"), exc)

        # NWS text products every 30 min
        self._nwws_tick += 1
        if self._nwws_tick >= (1800 // self.interval):
            self._nwws_tick = 0
            products = await self._fetch_nwws_products()
            if products:
                await set_feed("weather:nwws_products", products)

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

    async def _fetch_stations(self) -> list[dict]:
        """Latest reading from the primary station and its neighbours (one feed)."""
        ids = [settings.nws_station_primary] + [
            s.strip().upper() for s in settings.nws_nearby_stations.split(",") if s.strip()
        ]
        ids = list(dict.fromkeys(ids))

        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            async def one(sid: str) -> dict | None:
                try:
                    if sid not in self._station_meta:
                        m = await client.get(f"{NWS_BASE}/stations/{sid}")
                        m.raise_for_status()
                        mj = m.json()
                        lon, lat = (mj.get("geometry") or {}).get("coordinates", [None, None])[:2]
                        self._station_meta[sid] = {
                            "name": (mj.get("properties") or {}).get("name") or sid,
                            "lat": lat, "lon": lon,
                        }
                    r = await client.get(f"{NWS_BASE}/stations/{sid}/observations/latest")
                    r.raise_for_status()
                    return {"id": sid, **self._station_meta[sid], **normalize_observation(r.json())}
                except Exception as exc:
                    logger.debug("[weather] station %s failed: %s", sid, exc)
                    return None

            got = await asyncio.gather(*(one(s) for s in ids))
        return [g for g in got if g and g.get("temp_f") is not None]

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
            async with httpx.AsyncClient(
                timeout=30,
                follow_redirects=True,
                event_hooks={'request': [validate_request_url]}
            ) as client:
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

    async def _fetch_nwws_products(self) -> list[dict]:
        """Fetch recent NWS text products (AFD, LSR, CF6) for the local forecast office.

    HWO is not fetched: the Portland office no longer publishes it as text (the
    API returns none for PQR/PDX)."""
        office = settings.nws_office or "PQR"
        climate = settings.nws_climate_station or "PDX"
        product_types = [
            ("AFD", "Area Forecast Discussion", office),
            ("LSR", "Local Storm Report", office),
            ("CF6", "F6 Climate Data", climate),
        ]
        results: list[dict] = []
        async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
            for code, name, location in product_types:
                url = f"{NWS_BASE}/products/types/{code}/locations/{location}"
                try:
                    resp = await client.get(url)
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    items = (data.get("@graph") or [])[:1]  # only the latest
                    for item in items:
                        # Fetch full product text if only a stub is returned
                        text = item.get("productText")
                        if not text:
                            product_url = item.get("@id") or item.get("id")
                            if product_url:
                                try:
                                    pr = await client.get(product_url)
                                    if pr.status_code == 200:
                                        text = pr.json().get("productText", "")
                                except Exception:
                                    pass
                        results.append({
                            "code": code,
                            "name": name,
                            "office": location,
                            "issuance_time": item.get("issuanceTime"),
                            "text": (text or "").strip(),
                        })
                except Exception as exc:
                    logger.debug("[weather] NWWS %s fetch failed: %s", code, exc)
        return results
