import asyncio
import csv
import io
import logging
import os
import time
import zipfile
from dataclasses import dataclass, field as dc_field

import httpx

from bus import publish_entity
from config_loader import load_sources_config, GtfsRtFeedEntry
from .base import BasePoller

logger = logging.getLogger(__name__)

_STATIC_CACHE_TTL = 86_400.0   # 24 hours — route list rarely changes
_USER_AGENT = "Vertex/1.0 (Situational Awareness Dashboard)"

# GTFS extended route_type codes that represent rail/fixed-guideway
_RAIL_TYPES = {0, 1, 2, 5, 7, 12, 100, 101, 102, 103, 105, 106, 107, 400, 401, 402}


@dataclass
class _FeedState:
    feed: GtfsRtFeedEntry
    route_map: dict[str, dict] = dc_field(default_factory=dict)
    route_map_ts: float = 0.0
    poll_task: asyncio.Task | None = None
    poll_count: int = 0


class GtfsRtPoller(BasePoller):
    """Generic GTFS-Realtime vehicle-positions poller.

    Feeds are declared in the ``gtfs_rt`` section of sources.yml.  Each feed
    runs its own async task at its own poll_interval.  The outer run() loop
    is used only for config hot-reload and task health checks.
    """

    name = "gtfs_rt"
    interval = 30  # outer loop: reload config + restart dead tasks

    def __init__(self):
        self._states: dict[str, _FeedState] = {}
        self._config_ts: float = 0.0

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def setup(self):
        await self._reload_config()

    async def poll(self):
        if time.monotonic() - self._config_ts > 30:
            await self._reload_config()
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

    # ── Config ────────────────────────────────────────────────────────────────

    async def _reload_config(self):
        config = load_sources_config()
        current_names = {f.name for f in config.gtfs_rt if f.enabled}

        for name in list(self._states.keys()):
            if name not in current_names:
                state = self._states.pop(name)
                if state.poll_task and not state.poll_task.done():
                    state.poll_task.cancel()
                logger.info("[gtfs_rt] removed feed: %s", name)

        for feed in config.gtfs_rt:
            if not feed.enabled:
                continue
            if feed.name not in self._states:
                state = _FeedState(feed=feed)
                self._states[feed.name] = state
                state.poll_task = asyncio.create_task(self._feed_loop(state))
                logger.info("[gtfs_rt] started feed: %s (%s)", feed.name, feed.label)
            else:
                self._states[feed.name].feed = feed  # hot-update config

        self._config_ts = time.monotonic()

        if not self._states:
            logger.info(
                "[gtfs_rt] no enabled GTFS-RT feeds — add entries under gtfs_rt: in sources.yml"
            )

    # ── Per-feed loop ─────────────────────────────────────────────────────────

    async def _feed_loop(self, state: _FeedState):
        feed = state.feed

        if feed.api_key_env:
            key = os.environ.get(feed.api_key_env, "")
            if not key:
                logger.warning(
                    "[gtfs_rt:%s] env var %s is not set — set it in .env to enable this feed",
                    feed.name, feed.api_key_env,
                )

        while True:
            try:
                await self._poll_once(state)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[gtfs_rt:%s] poll error: %s", feed.name, exc)
            await asyncio.sleep(state.feed.poll_interval)

    # ── Static GTFS route map ─────────────────────────────────────────────────

    async def _ensure_route_map(self, state: _FeedState) -> dict[str, dict]:
        now = time.monotonic()
        if state.route_map and (now - state.route_map_ts) < _STATIC_CACHE_TTL:
            return state.route_map

        feed = state.feed
        api_key = os.environ.get(feed.api_key_env, "") if feed.api_key_env else ""
        params: dict[str, str] = {}
        if api_key and feed.api_key_param:
            params[feed.api_key_param] = api_key

        try:
            async with httpx.AsyncClient(timeout=90) as client:
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
                    }

            state.route_map = route_map
            state.route_map_ts = now
            logger.info(
                "[gtfs_rt:%s] loaded %d routes from static GTFS", feed.name, len(route_map)
            )
        except Exception as exc:
            logger.warning("[gtfs_rt:%s] static GTFS fetch failed: %s", feed.name, exc)

        return state.route_map

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
        api_key = os.environ.get(feed.api_key_env, "") if feed.api_key_env else ""
        params: dict[str, str] = {}
        if api_key and feed.api_key_param:
            params[feed.api_key_param] = api_key

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

            route_id = v.trip.route_id if v.HasField("trip") else ""
            trip_id = v.trip.trip_id if v.HasField("trip") else ""
            route_info = route_map.get(route_id, {})
            route_type = route_info.get("type", -1)

            if route_type not in allowed_types:
                continue

            vehicle_id = (v.vehicle.id if v.HasField("vehicle") and v.vehicle.id else ent.id) or ent.id
            vehicle_label = v.vehicle.label if v.HasField("vehicle") else vehicle_id
            short_name = route_info.get("short_name", "")
            long_name = route_info.get("long_name", "")

            # GTFS-RT speed is m/s → convert to knots
            speed_kts = round(float(pos.speed) * 1.94384, 1) if pos.speed else None
            # bearing is 0–360° true north, matching our heading field
            heading = float(pos.bearing) if pos.bearing else None

            display_name = f"{short_name} — {vehicle_label}".strip(" —") if short_name else f"Vehicle {vehicle_label}"

            entity = {
                "entity_id": f"gtfs:{feed.name}:{vehicle_id}",
                "entity_type": "train",
                "source": f"gtfs_{feed.name}",
                "display_name": display_name,
                "lat": lat,
                "lon": lon,
                "heading": heading,
                "speed": speed_kts,
                "altitude": None,
                "status": None,
                "identity": {
                    "vehicle_id": vehicle_id,
                    "vehicle_label": vehicle_label,
                    "route_id": route_id,
                    "route_short_name": short_name,
                    "route_long_name": long_name,
                    "route_type": route_type,
                    "trip_id": trip_id,
                    "feed": feed.name,
                    "feed_label": feed.label,
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
