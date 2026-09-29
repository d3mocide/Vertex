import ipaddress
import logging
import re
import time
import httpx
from urllib.parse import urlparse
from config import settings
from bus import set_feed
from normalizers.beast_math import haversine_km
from .base import BasePoller

logger = logging.getLogger(__name__)

# ODOT TripCheck Data API — free, requires key from developer.odot.state.or.us
_ODOT_API_BASE = "https://api.odot.state.or.us/tripcheck"
_ODOT_INCIDENTS_PATH = "/Incidents"
_ODOT_CCTV_PATH = "/Cctv/Inventory"
_ODOT_FLOW_PATH = "/TrafficDetector/Roadway"
_ODOT_INV_PATH = "/TrafficDetector/Inventory"
_ODOT_DMS_INV_PATH = "/Dms/Inventory"
_ODOT_DMS_STATUS_PATH = "/Dms/Status"
_SIGNS_EVERY_N_POLLS = 2   # sign messages change with conditions: check every couple of minutes
_ODOT_RWIS_INV_PATH = "/Rwis/Inventory"
_ODOT_RWIS_STATUS_PATH = "/Rwis/Status"
_RWIS_RADIUS_KM = 100      # statewide list is 229 stations; keep the ones around us
_RWIS_EVERY_N_POLLS = 5    # stations report every ~10 min; the poll is every minute


class TrafficPoller(BasePoller):
    name = "traffic"
    interval = 60

    def __init__(self):
        self._station_map: dict = {}
        self._rwis_inventory: list = []
        self._rwis_tick = _RWIS_EVERY_N_POLLS  # first poll fetches
        self._signs_tick = _SIGNS_EVERY_N_POLLS
        self._signs_inventory: list = []
        self._signs_inventory_at = 0.0
        self._rwis_inventory_at = 0.0

    async def setup(self):
        if not settings.odot_api_key:
            logger.warning(
                "[traffic] ODOT_API_KEY not set — traffic incidents/cameras disabled."
            )
        else:
            logger.info("[traffic] ODOT TripCheck API configured")

    async def poll(self):
        if not settings.odot_api_key:
            return

        headers = {
            "Ocp-Apim-Subscription-Key": settings.odot_api_key,
            "User-Agent": "Vertex/0.1 (vertex; contact@localhost)",
        }
        
        # Note: Inventory API doesn't use 'county' param, but Incidents does.
        # We'll filter manually for cameras to be safe.

        async with httpx.AsyncClient(timeout=15) as client:
            # 1. Fetch Incidents
            try:
                url = f"{_ODOT_API_BASE}{_ODOT_INCIDENTS_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                await set_feed("traffic:incidents", _parse_odot_incidents(resp.json()))
            except Exception as exc:
                logger.warning("[traffic] incidents fetch failed: %s", exc)

            # 2. Fetch CCTV Cameras
            try:
                url = f"{_ODOT_API_BASE}{_ODOT_CCTV_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                cameras = _parse_odot_cameras(resp.json())
                await _check_camera_health(cameras)
                await set_feed("traffic:cameras", cameras)
            except Exception as exc:
                logger.warning("[traffic] cctv fetch failed: %s", exc)

            # 3. Fetch Roadway Flow
            try:
                # Refresh inventory occasionally (every 10 polls)
                if not self._station_map:
                    url = f"{_ODOT_API_BASE}{_ODOT_INV_PATH}"
                    resp = await client.get(url, headers=headers)
                    if resp.status_code == 200:
                        self._station_map = _parse_odot_inventory(resp.json())

                url = f"{_ODOT_API_BASE}{_ODOT_FLOW_PATH}"
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                stations = _parse_odot_flow(resp.json(), self._station_map)
                if stations:
                    await set_feed("traffic:flow", stations)
                    await set_feed("traffic:corridors",
                                   summarize_corridors(stations, settings.region_lat, settings.region_lon))
                else:
                    logger.warning("[traffic] flow came back with no usable detectors; keeping previous readings")
            except Exception as exc:
                logger.warning("[traffic] flow fetch failed: %s", exc)

            # 4. Road-weather stations (RWIS) around the region
            self._rwis_tick += 1
            if self._rwis_tick >= _RWIS_EVERY_N_POLLS:
                self._rwis_tick = 0
                try:
                    # Inventory (locations) barely changes: refresh hourly.
                    if not self._rwis_inventory or time.time() - self._rwis_inventory_at > 3600:
                        resp = await client.get(f"{_ODOT_API_BASE}{_ODOT_RWIS_INV_PATH}", headers=headers)
                        resp.raise_for_status()
                        self._rwis_inventory = resp.json().get("ess-site-list") or []
                        self._rwis_inventory_at = time.time()
                    resp = await client.get(f"{_ODOT_API_BASE}{_ODOT_RWIS_STATUS_PATH}", headers=headers)
                    resp.raise_for_status()
                    statuses = resp.json().get("WeatherStations") or []
                    if not statuses:
                        # ODOT sometimes answers 200 with an empty list; keep the last
                        # good feed rather than blanking the card.
                        logger.warning("[traffic] RWIS status came back empty; keeping the previous readings")
                    else:
                        await set_feed(
                            "weather:rwis",
                            parse_rwis(self._rwis_inventory, statuses, settings.region_lat, settings.region_lon),
                        )
                except Exception as exc:
                    logger.warning("[traffic] RWIS fetch failed: %s", exc)

            # 5. Message signs (what the freeway signs are telling drivers right now)
            self._signs_tick += 1
            if self._signs_tick >= _SIGNS_EVERY_N_POLLS:
                self._signs_tick = 0
                try:
                    if not self._signs_inventory or time.time() - self._signs_inventory_at > 3600:
                        resp = await client.get(f"{_ODOT_API_BASE}{_ODOT_DMS_INV_PATH}", headers=headers)
                        resp.raise_for_status()
                        self._signs_inventory = resp.json().get("dms-inventory-items") or []
                        self._signs_inventory_at = time.time()
                    resp = await client.get(f"{_ODOT_API_BASE}{_ODOT_DMS_STATUS_PATH}", headers=headers)
                    resp.raise_for_status()
                    statuses = resp.json().get("dmsItems") or []
                    if not statuses:
                        logger.warning("[traffic] sign status came back empty; keeping the previous messages")
                    else:
                        await set_feed("traffic:signs",
                                       parse_signs(self._signs_inventory, statuses, settings.region_lat, settings.region_lon))
                except Exception as exc:
                    logger.warning("[traffic] message sign fetch failed: %s", exc)


def _parse_odot_incidents(data: dict) -> list[dict]:
    """Normalize ODOT TripCheck API incident response.

    Supports both legacy flat keys and current nested hyphenated keys.
    """
    items: list[dict] = []
    h_lat = settings.region_lat
    h_lon = settings.region_lon
    records = data.get("incidents", []) if isinstance(data, dict) else (data or [])
    for inc in records:
        # ODOT currently returns is-active as "true"/"false" strings.
        active = inc.get("is-active")
        if isinstance(active, str) and active.lower() != "true":
            continue
        if isinstance(active, bool) and not active:
            continue

        loc = inc.get("location") or {}
        start_loc = loc.get("start-location") or {}
        end_loc = loc.get("end-location") or {}

        lat = _first_number(
            inc.get("latitude"),
            start_loc.get("start-lat"),
            end_loc.get("end-lat"),
        )
        lon = _first_number(
            inc.get("longitude"),
            start_loc.get("start-long"),
            end_loc.get("end-long"),
        )

        # Keep incidents local to the configured operating region.
        if lat is not None and lon is not None:
            if not (
                settings.bbox_min_lat <= lat <= settings.bbox_max_lat
                and settings.bbox_min_lon <= lon <= settings.bbox_max_lon
            ):
                continue
        else:
            # Incidents without usable coordinates cannot be region-scoped reliably.
            continue

        location = (
            start_loc.get("location-desc")
            or loc.get("location-name")
            or inc.get("locationDescription", "")
        )

        title = (
            inc.get("headline")
            or inc.get("incidentSubType")
            or inc.get("incidentType")
            or inc.get("impact-desc")
            or "Traffic incident"
        )
        description = inc.get("comments") or inc.get("description") or location
        severity = inc.get("impact-desc") or inc.get("severity", "")

        route = loc.get("route-id") or ""
        direction = loc.get("direction") or ""
        if route and direction and location:
            location = f"{route} {direction} - {location}"
        elif route and location:
            location = f"{route} - {location}"

        items.append({
            "title":       _clean(title),
            "description": _clean(description),
            "location":    location,
            "link":        inc.get("info-url", ""),
            "pubDate":     inc.get("update-time", inc.get("create-time", inc.get("startTime", ""))),
            "lat":         lat,
            "lon":         lon,
            "severity":    severity,
            "dist_km":     round(_distance_km(h_lat, h_lon, lat, lon), 2),
        })

    # Keep nearest incidents at the top, consistent with camera ordering.
    items.sort(key=lambda x: x.get("dist_km", float("inf")))
    return items


def _clean(text) -> str:
    """Strip ODOT's embedded markup: "<!--Links Start Here-->" comments, HTML
    tags and markdown links ("[label](url)" -> "label"). The UI was showing it raw."""
    text = re.sub(r"<!--.*?-->", " ", str(text or ""), flags=re.S)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _first_number(*values):
    for value in values:
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                continue
    return None


def _distance_km(h_lat: float, h_lon: float, lat: float, lon: float) -> float:
    return haversine_km(h_lat, h_lon, lat, lon)


def _parse_odot_cameras(data: dict) -> list[dict]:
    """Normalize ODOT TripCheck API CCTV response with distance filtering."""
    items: list[dict] = []
    records = data.get("CCTVInventoryRequest", [])
    
    # Home location
    h_lat = settings.region_lat
    h_lon = settings.region_lon
    
    for cam in records:
        lat = cam.get("latitude")
        lon = cam.get("longitude")
        
        if lat is None or lon is None:
            continue
            
        dist_km = haversine_km(h_lat, h_lon, lat, lon)

        # Filter by global bounding box to ensure consistency across tactical layers
        if not (settings.bbox_min_lat <= lat <= settings.bbox_max_lat and
                settings.bbox_min_lon <= lon <= settings.bbox_max_lon):
            continue

        items.append({
            "id":      str(cam.get("device-id", "")),
            "name":    cam.get("device-name", ""),
            "url":     cam.get("cctv-url", ""),
            "ldi_url": cam.get("cctv-url", ""),
            "lat":     lat,
            "lon":     lon,
            "road":    cam.get("route-id", ""),
            "dist_km": round(dist_km, 2),
        })
    
    # Sort by distance
    items.sort(key=lambda x: x["dist_km"])
    return items


def _road_key(highway: str) -> str:
    """ODOT prefixes some detector names with a region ("R3 I-5"); drop it."""
    return re.sub(r"^R\d+\s+", "", (highway or "").strip())


def _parse_odot_flow(data: dict, station_map: dict) -> list[dict]:
    """Normalize ODOT Traffic Detector response: one reading per station.

    The API reports every lane separately. Speed is the vehicle-weighted mean of the
    lanes that saw traffic; a lane that counted no vehicles reports speed 0, which
    means "nobody there", not "stopped", so it never drags a station to zero.
    """
    corridors = {c.strip() for c in settings.traffic_flow_corridors.split(",") if c.strip()}
    lanes: dict = {}
    for rec in data.get("detector-data-items", []):
        detail = (rec.get("detector-list") or {}).get("detector-data-detail") or {}
        sid = detail.get("station-id")
        if sid is None or sid not in station_map:
            continue
        lanes.setdefault(sid, []).append(detail)

    items: list[dict] = []
    for sid, details in lanes.items():
        meta = station_map[sid]
        if _road_key(meta.get("road", "")) not in corridors:
            continue
        if meta.get("cls") and meta["cls"] != "MAINLINE":
            continue            # ramp detectors say nothing about the corridor
        moving = [(d.get("vehicle-count") or 0, d.get("vehicle-speed")) for d in details
                  if (d.get("vehicle-count") or 0) > 0 and (d.get("vehicle-speed") or 0) > 0]
        total = sum(c for c, _ in moving)
        speed = round(sum(c * sp for c, sp in moving) / total) if total else None
        occs = [d.get("vehicle-occupancy") for d in details if d.get("vehicle-occupancy") is not None]
        items.append({
            "id":    str(sid),
            "road":  _road_key(meta.get("road", "")),
            "dir":   meta.get("dir", ""),
            "loc":   meta.get("loc", ""),
            "speed": speed,
            "occ":   round(sum(occs) / len(occs)) if occs else None,
            "vol":   sum(d.get("vehicle-count") or 0 for d in details),
            "lat":   meta.get("lat"),
            "lon":   meta.get("lon"),
        })
    return items


# ─── Corridor status ──────────────────────────────────────────────────────────
_DIR_NAMES = {"N": "Northbound", "S": "Southbound", "E": "Eastbound", "W": "Westbound"}
_DIR_ORDER = {"N": 0, "S": 1, "E": 2, "W": 3}
_ROAD_ORDER = ["I-5", "I-205", "I-84", "I-405", "US26", "OR-217"]
_HEAVY_MPH, _SLOW_MPH = 25, 45     # median corridor speed below which it is heavy / slow
_MIN_VOL = 3                       # vehicles in the interval before a slow reading counts as a queue
_CORRIDOR_RADIUS_KM = 30


def summarize_corridors(stations: list[dict], lat: float, lon: float,
                        radius_km: float = _CORRIDOR_RADIUS_KM) -> list[dict]:
    """Per road and direction near the region: median speed, the slowest spot, a status.

    status: "normal" | "slow" | "heavy" | "quiet" (detectors report, nobody driving — late
    night) | "nodata" (detectors report nothing).
    """
    groups: dict[tuple[str, str], list[dict]] = {}
    for st in stations:
        if st.get("lat") is None or st.get("lon") is None:
            continue
        if haversine_km(st["lat"], st["lon"], lat, lon) > radius_km:
            continue
        groups.setdefault((st["road"], st.get("dir", "")), []).append(st)

    out: list[dict] = []
    for (road, direction), group in groups.items():
        valid = [s for s in group if s.get("speed") is not None]
        # A "2 mph" from one vehicle is a sensor near a ramp, not a queue: judge the corridor by
        # detectors that actually saw traffic, and only fall back to the thin readings if none did.
        solid = [s for s in valid if (s.get("vol") or 0) >= _MIN_VOL]
        speeds = sorted(s["speed"] for s in (solid or valid))
        slowest = min(solid or valid, key=lambda s: s["speed"], default=None)
        if speeds:
            median = speeds[len(speeds) // 2] if len(speeds) % 2 else round((speeds[len(speeds) // 2 - 1] + speeds[len(speeds) // 2]) / 2)
            crawling = sum(1 for s in solid if s["speed"] < _HEAVY_MPH)
            status = "heavy" if median < _HEAVY_MPH else "slow" if (median < _SLOW_MPH or crawling >= 2) else "normal"
        else:
            median = None
            status = "quiet" if any(s.get("vol") == 0 for s in group) else "nodata"
        out.append({
            "road": road, "dir": direction,
            "label": f"{road} {_DIR_NAMES.get(direction, direction)}".strip(),
            "status": status, "speed": median,
            "stations": len(group), "reporting": len(valid),
            "slowest": {"loc": slowest["loc"], "speed": slowest["speed"]} if slowest else None,
        })
    out.sort(key=lambda c: (_ROAD_ORDER.index(c["road"]) if c["road"] in _ROAD_ORDER else 99,
                            _DIR_ORDER.get(c["dir"], 9)))
    return out


# ─── Message signs (DMS) ──────────────────────────────────────────────────────
_TRAVEL_SIGN = re.compile(r"TRAVEL TIME|\bMIN\b|^[\d\s/]+$", re.I)
_SIGN_RADIUS_KM = 60
_SIGN_MAX = 12


def parse_signs(inventory: list, statuses: list, lat: float, lon: float,
                radius_km: float = _SIGN_RADIUS_KM) -> list[dict]:
    """Nearby ODOT message signs that are showing something, nearest first."""
    by_id = {s.get("device-id"): s for s in statuses}
    out: list[dict] = []
    for dev in inventory:
        dlat, dlon = dev.get("latitude"), dev.get("longitude")
        if dlat is None or dlon is None:
            continue
        st = by_id.get(dev.get("device-id")) or {}
        if str(st.get("dms-device-status", "")).lower() != "in service":
            continue
        msg = st.get("dmsCurrentMessage") or {}
        p1 = [str(msg.get(f"phase1Line{i}") or "").strip() for i in (1, 2, 3)]
        p2 = [str(msg.get(f"phase2Line{i}") or "").strip() for i in (1, 2, 3)]
        p1, p2 = [t for t in p1 if t], [t for t in p2 if t]
        if not p1 and not p2:
            continue
        dist = haversine_km(dlat, dlon, lat, lon)
        if dist > radius_km:
            continue
        text = " / ".join(p1 or p2)
        out.append({
            "id": dev.get("device-id"),
            "name": (dev.get("device-name") or "").strip(),
            "route": dev.get("route-id"),
            "dist_km": round(dist, 1),
            "page1": p1, "page2": p2 if p2 != p1 else [],
            "text": text,
            # Travel times / speeds are routine; anything else is a message drivers were meant to read.
            "kind": "travel" if _TRAVEL_SIGN.search(text) else "message",
        })
    out.sort(key=lambda d: (d["kind"] != "message", d["dist_km"]))
    return out[:_SIGN_MAX]


def _parse_odot_inventory(data: dict) -> dict:
    """Map station-id to location metadata (road, direction, class, position)."""
    mapping = {}
    stations = data.get("traffic-detector-list", [])
    for s in stations:
        loc = s.get("location", {})
        det = s.get("detector-station", {})
        sid = det.get("station-id")
        if sid is not None:
            mapping[sid] = {
                "road": loc.get("highway-name", ""),
                "loc":  loc.get("location-name", ""),
                "dir":  (loc.get("highway-direction") or "").strip().upper(),
                "cls":  (det.get("station-class") or "").strip().upper(),
                "lat":  loc.get("latitude"),
                "lon":  loc.get("longitude"),
            }
    return mapping


def _is_public_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname or ""
        try:
            ip = ipaddress.ip_address(hostname)
            return ip.is_global
        except ValueError:
            pass  # hostname, not IP literal — DNS not pre-resolved on Pi
        return bool(hostname)
    except Exception:
        return False


async def _check_camera_health(cameras: list[dict]) -> None:
    """HEAD-check each camera URL and annotate with health status + last_ok_ts.

    Health values: ``"ok"`` (200–399), ``"warn"`` (4xx), ``"down"`` (error/timeout).
    Runs all checks concurrently with a short per-request timeout.
    """
    import asyncio
    import time

    async def _probe(cam: dict) -> None:
        url = cam.get("url", "")
        if not url or not _is_public_url(url):
            cam["health"] = "unknown"
            cam["last_ok_ts"] = None
            return
        try:
            async with httpx.AsyncClient(timeout=4) as hc:
                r = await hc.head(url)
            if r.status_code < 400:
                cam["health"] = "ok"
                cam["last_ok_ts"] = int(time.time())
            else:
                cam["health"] = "warn"
                cam["last_ok_ts"] = None
        except Exception:
            cam["health"] = "down"
            cam["last_ok_ts"] = None

    await asyncio.gather(*[_probe(cam) for cam in cameras])



# ─── ODOT road-weather stations (RWIS) ────────────────────────────────────────
# Units, checked against neighbouring NWS stations: temperatures (air, dew point,
# pavement) are hundredths of °C, wind is mph. 32767 / 65535 mean "no reading".
# Some sensors report id -1 for several different sites, so their status rows
# cannot be told apart — those stations are skipped.
_RWIS_MISSING = {32767, 65535, -32768}


def _rwis_val(v):
    return None if v is None or v in _RWIS_MISSING else v


def _c100_to_f(v):
    v = _rwis_val(v)
    return None if v is None else round(v / 100 * 9 / 5 + 32, 1)


def parse_rwis(inventory: list, statuses: list, lat: float, lon: float,
               radius_km: float = _RWIS_RADIUS_KM) -> list[dict]:
    """Nearby ODOT road-weather stations with readings in display units, nearest first."""
    by_id = {s.get("station-id"): s for s in statuses}
    out: list[dict] = []
    for site in inventory:
        slat, slon = site.get("latitude"), site.get("longitude")
        if slat is None or slon is None or (site.get("station-id") or -1) <= 0:
            continue
        dist = haversine_km(slat, slon, lat, lon)
        if dist > radius_km:
            continue
        st = by_id.get(site.get("station-id")) or {}
        rw = st.get("RoadWeather") or {}
        sc = st.get("SurfaceCondition") or {}
        surface = [_c100_to_f(t.get("surface-temperature")) for t in (sc.get("surface-temperatures") or [])]
        surface = [t for t in surface if t is not None]
        temp_f = _c100_to_f(rw.get("air-temperature"))
        wind = _rwis_val(rw.get("avg-wind-speed"))
        # A station with no air temperature and no wind has nothing to show.
        if temp_f is None and wind is None and not surface:
            continue
        precip = rw.get("precip-type")
        out.append({
            "id": site.get("station-id"),
            "name": (site.get("station-name") or "").replace("RWIS ", "", 1),
            "lat": slat, "lon": slon,
            "route": site.get("route-id"),
            "elev_ft": site.get("elevation"),
            "dist_km": round(dist, 1),
            "temp_f": temp_f,
            "dew_f": _c100_to_f(rw.get("dewpoint-temp")),
            "humidity": _rwis_val(rw.get("relative-humidity")),
            "wind_mph": wind,
            "gust_mph": _rwis_val(rw.get("avg-wind-gust-speed")),
            "visibility_m": _rwis_val(rw.get("visibility")),
            "precip": precip if precip and precip != "No Precipitation" else None,
            "surface_f": min(surface) if surface else None,
            "updated": rw.get("last-update-time"),
        })
    out.sort(key=lambda r: r["dist_km"])
    return out
