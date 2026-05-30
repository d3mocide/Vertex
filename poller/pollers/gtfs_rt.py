import asyncio
import csv
import io
import json
import logging
import time
import zipfile
from dataclasses import dataclass, field as dc_field

import httpx

from security import validate_request_url
from bus import get_bus, publish_entity
from config import settings
from .base import BasePoller

logger = logging.getLogger(__name__)

_STATIC_CACHE_TTL = 86_400.0   # 24 hours — route list rarely changes
_USER_AGENT = "Vertex/1.0 (Situational Awareness Dashboard)"


@dataclass
class _FeedConfig:
    name: str
    label: str
    static_gtfs_url: str
    realtime_url: str
    api_key: str
    api_key_param: str
    route_types: list[int]
    poll_interval: int


@dataclass
class _FeedState:
    feed: _FeedConfig
    route_map: dict[str, dict] = dc_field(default_factory=dict)
    route_map_ts: float = 0.0
    poll_task: asyncio.Task | None = None
    poll_count: int = 0


def _build_feeds() -> list[_FeedConfig]:
    feeds: list[_FeedConfig] = []
    if settings.trimet_gtfs_enabled:
        if not settings.trimet_app_id:
            logger.warning(
                "[gtfs_rt] TRIMET_GTFS_ENABLED=true but TRIMET_APP_ID is not set"
            )
        route_types = [
            int(x.strip())
            for x in settings.trimet_route_types.split(",")
            if x.strip().isdigit()
        ]
        feeds.append(_FeedConfig(
            name="trimet",
            label="TriMet Portland Metro",
            static_gtfs_url=settings.trimet_gtfs_static_url,
            realtime_url=settings.trimet_gtfs_rt_url,
            api_key=settings.trimet_app_id,
            api_key_param="appID",
            route_types=route_types,
            poll_interval=settings.trimet_poll_interval,
        ))
    return feeds


class GtfsRtPoller(BasePoller):
    """GTFS-Realtime vehicle-positions poller.

    Feeds are configured via environment variables (TRIMET_GTFS_ENABLED, etc.).
    Each enabled feed runs its own async task.  The outer run() loop handles
    task health checks.
    """

    name = "gtfs_rt"
    interval = 30  # outer loop: restart dead tasks

    def __init__(self):
        self._states: dict[str, _FeedState] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def setup(self):
        self._start_feeds()

    async def poll(self):
        for name, state in list(self._states.items()):
            if state.poll_task is None or state.poll_task.done():
                if state.poll_task and state.poll_task.done():
                    exc = state.poll_task.exception()
                    if exc:
                        logger.warning("[gtfs_rt:%s] feed task died: %s", name, exc)
                state.poll_task = asyncio.create_task(self._feed_loop(state))
                logger.info("[gtfs_rt:%s] (re)started feed task", name)

    async def close(self):
        for state in self._states.values():
            if state.poll_task and not state.poll_task.done():
                state.poll_task.cancel()
                try:
                    await state.poll_task
                except asyncio.CancelledError:
                    pass

    # ── Feed management ───────────────────────────────────────────────────────

    def _start_feeds(self):
        feeds = _build_feeds()
        if not feeds:
            logger.info(
                "[gtfs_rt] no GTFS-RT feeds enabled "
                "(set TRIMET_GTFS_ENABLED=true + TRIMET_API_KEY to enable TriMet)"
            )
            return
        for feed in feeds:
            state = _FeedState(feed=feed)
            self._states[feed.name] = state
            state.poll_task = asyncio.create_task(self._feed_loop(state))
            logger.info("[gtfs_rt] started feed: %s (%s)", feed.name, feed.label)

    # ── Per-feed loop ─────────────────────────────────────────────────────────

    async def _feed_loop(self, state: _FeedState):
        while True:
            try:
                await self._poll_once(state)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[gtfs_rt:%s] poll error: %s", state.feed.name, exc)
            await asyncio.sleep(state.feed.poll_interval)

    # ── Static GTFS route map ─────────────────────────────────────────────────

    async def _ensure_route_map(self, state: _FeedState) -> dict[str, dict]:
        now = time.monotonic()
        if state.route_map and (now - state.route_map_ts) < _STATIC_CACHE_TTL:
            return state.route_map

        feed = state.feed
        params: dict[str, str] = {}
        if feed.api_key and feed.api_key_param:
            params[feed.api_key_param] = feed.api_key

        try:
            async with httpx.AsyncClient(
                timeout=90,
                event_hooks={'request': [validate_request_url]}
            ) as client:
                resp = await client.get(
                    feed.static_gtfs_url,
                    params=params,
                    headers={"User-Agent": _USER_AGENT},
                    follow_redirects=True,
                )
                resp.raise_for_status()

            zf = zipfile.ZipFile(io.BytesIO(resp.content))
            route_map: dict[str, dict] = {}
            with zf.open("routes.txt") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, "utf-8"))
                for row in reader:
                    route_map[row["route_id"]] = {
                        "type": int(row.get("route_type", -1)),
                        "short_name": row.get("route_short_name", "").strip(),
                        "long_name": row.get("route_long_name", "").strip(),
                        "color": row.get("route_color", "").strip(),
                        "text_color": row.get("route_text_color", "FFFFFF").strip(),
                    }

            state.route_map = route_map
            state.route_map_ts = now
            logger.info(
                "[gtfs_rt:%s] loaded %d routes from static GTFS", feed.name, len(route_map)
            )

            # Check if shapes are already cached to avoid redundant heavy parsing on restart
            redis_key = f"cache:gtfs:{feed.name}:shapes"
            r = await get_bus()
            if await r.exists(redis_key):
                logger.info("[gtfs_rt:%s] shapes already cached in Redis, skipping build", feed.name)
            else:
                asyncio.create_task(
                    self._build_and_cache_shapes(zf, route_map, set(feed.route_types), feed.name)
                )
        except Exception as exc:
            logger.warning("[gtfs_rt:%s] static GTFS fetch failed: %s", feed.name, exc)

        return state.route_map

    # ── GTFS shape cache builder ───────────────────────────────────────────────

    async def _build_and_cache_shapes(
        self,
        zf: zipfile.ZipFile,
        route_map: dict[str, dict],
        allowed_types: set[int],
        feed_name: str,
    ) -> None:
        """Parse shapes.txt + trips.txt from the static GTFS zip and write one
        MultiLineString GeoJSON feature per route to Redis."""
        try:
            namelist = zf.namelist()

            # trips.txt: first shape_id seen per route_id wins
            shape_to_route: dict[str, str] = {}
            if "trips.txt" in namelist:
                with zf.open("trips.txt") as f:
                    for row in csv.DictReader(io.TextIOWrapper(f, "utf-8")):
                        sid = row.get("shape_id", "").strip()
                        rid = row.get("route_id", "").strip()
                        if sid and rid and sid not in shape_to_route:
                            shape_to_route[sid] = rid

            # shapes.txt: collect (seq, lon, lat) tuples per shape_id
            shape_pts: dict[str, list[tuple[int, float, float]]] = {}
            if "shapes.txt" in namelist:
                with zf.open("shapes.txt") as f:
                    for row in csv.DictReader(io.TextIOWrapper(f, "utf-8")):
                        sid = row.get("shape_id", "").strip()
                        if not sid:
                            continue
                        try:
                            lat = float(row["shape_pt_lat"])
                            lon = float(row["shape_pt_lon"])
                            seq = int(row.get("shape_pt_sequence", 0))
                        except (KeyError, ValueError):
                            continue
                        shape_pts.setdefault(sid, []).append((seq, lon, lat))

            # Sort each shape by sequence and flatten to [lon, lat] pairs
            sorted_shapes: dict[str, list[list[float]]] = {}
            for sid, pts in shape_pts.items():
                pts.sort(key=lambda x: x[0])
                sorted_shapes[sid] = [[lon, lat] for _, lon, lat in pts]

            # Group shapes into one MultiLineString per route (rail types only)
            route_lines: dict[str, list[list[list[float]]]] = {}
            for shape_id, route_id in shape_to_route.items():
                info = route_map.get(route_id)
                if info is None or info["type"] not in allowed_types:
                    continue
                coords = sorted_shapes.get(shape_id)
                if not coords or len(coords) < 2:
                    continue
                route_lines.setdefault(route_id, []).append(coords)

            features = []
            for route_id, lines in route_lines.items():
                info = route_map[route_id]
                raw_color = info.get("color", "").strip()
                raw_text  = info.get("text_color", "FFFFFF").strip()
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "MultiLineString", "coordinates": lines},
                    "properties": {
                        "route_id":         route_id,
                        "route_short_name": info["short_name"],
                        "route_long_name":  info["long_name"],
                        "route_type":       info["type"],
                        "route_color":      f"#{raw_color}" if raw_color else "#a78bfa",
                        "route_text_color": f"#{raw_text}"  if raw_text  else "#FFFFFF",
                    },
                })

            geojson = {"type": "FeatureCollection", "features": features}
            redis_key = f"cache:gtfs:{feed_name}:shapes"
            r = await get_bus()
            await r.set(redis_key, json.dumps(geojson), ex=int(_STATIC_CACHE_TTL) + 3600)
            logger.info(
                "[gtfs_rt:%s] cached %d route shapes to Redis (%s)",
                feed_name, len(features), redis_key,
            )
        except Exception as exc:
            logger.warning("[gtfs_rt:%s] shape cache build failed: %s", feed_name, exc)

    # ── GTFS-RT fetch + parse ─────────────────────────────────────────────────

    async def _poll_once(self, state: _FeedState):
        try:
            from google.transit import gtfs_realtime_pb2
        except ImportError:
            logger.error(
                "[gtfs_rt] gtfs-realtime-bindings not installed — "
                "add it to poller/requirements.txt"
            )
            await asyncio.sleep(300)
            return

        feed = state.feed
        params: dict[str, str] = {}
        if feed.api_key and feed.api_key_param:
            params[feed.api_key_param] = feed.api_key

        route_map = await self._ensure_route_map(state)
        allowed_types = set(feed.route_types)

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                feed.realtime_url,
                params=params,
                headers={"User-Agent": _USER_AGENT},
            )
            resp.raise_for_status()

        fm = gtfs_realtime_pb2.FeedMessage()
        fm.ParseFromString(resp.content)

        published = 0
        for ent in fm.entity:
            if not ent.HasField("vehicle"):
                continue
            v = ent.vehicle
            if not v.HasField("position"):
                continue

            pos = v.position
            lat, lon = float(pos.latitude), float(pos.longitude)
            if not lat or not lon:
                continue

            route_id   = v.trip.route_id if v.HasField("trip") else ""
            trip_id    = v.trip.trip_id  if v.HasField("trip") else ""
            route_info = route_map.get(route_id, {})
            route_type = route_info.get("type", -1)

            if route_type not in allowed_types:
                continue

            vehicle_id    = (v.vehicle.id if v.HasField("vehicle") and v.vehicle.id else ent.id) or ent.id
            vehicle_label = v.vehicle.label if v.HasField("vehicle") else vehicle_id
            short_name    = route_info.get("short_name", "")
            long_name     = route_info.get("long_name", "")

            speed_kts = round(float(pos.speed) * 1.94384, 1) if pos.speed else None
            heading   = float(pos.bearing) if pos.bearing else None

            display_name = f"{short_name} — {vehicle_label}".strip(" —") if short_name else f"Vehicle {vehicle_label}"

            entity = {
                "entity_id":    f"gtfs:{feed.name}:{vehicle_id}",
                "entity_type":  "train",
                "source":       f"gtfs_{feed.name}",
                "display_name": display_name,
                "lat":          lat,
                "lon":          lon,
                "heading":      heading,
                "speed":        speed_kts,
                "altitude":     None,
                "status":       None,
                "identity": {
                    "vehicle_id":        vehicle_id,
                    "vehicle_label":     vehicle_label,
                    "route_id":          route_id,
                    "route_short_name":  short_name,
                    "route_long_name":   long_name,
                    "route_type":        route_type,
                    "trip_id":           trip_id,
                    "feed":              feed.name,
                    "feed_label":        feed.label,
                },
                "tags": [feed.label, short_name] if short_name else [feed.label],
            }

            await publish_entity(entity, ttl=300, record_observation=True)
            published += 1

        state.poll_count += 1
        if state.poll_count <= 3 or state.poll_count % 20 == 0:
            logger.info(
                "[gtfs_rt:%s] poll #%d: %d rail vehicles",
                feed.name, state.poll_count, published,
            )
