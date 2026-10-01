"""Shared GTFS engine for reviewed, locally scoped regional agency feeds."""
import asyncio
import csv
import hashlib
import io
import json
import logging
import math
import re
import time
import zipfile
from datetime import datetime, timezone

import httpx
from google.transit import gtfs_realtime_pb2

import provider_catalog  # installs the reviewed shared support path
from transit_sources import SOURCES
from bus import get_bus, publish_entity, set_feed
from config import settings
from security import send_pinned_http_request
from .base import BasePoller
from .transit_path import motion_path

logger = logging.getLogger(__name__)

MAX_ZIP_BYTES = 50 * 1024 * 1024
MAX_EXPANDED_BYTES = 300 * 1024 * 1024
MAX_ROWS = 8_000_000


def bbox(region):
    return (region.bbox_min_lon, region.bbox_min_lat, region.bbox_max_lon, region.bbox_max_lat)


def point_inside(lon, lat, box):
    return (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90
            and box[0] <= lon <= box[2] and box[1] <= lat <= box[3])


def clip_segment(a, b, box):
    """Liang-Barsky: also finds crossings with neither endpoint inside the box."""
    x, y = a; dx, dy = b[0] - x, b[1] - y
    low, high = 0.0, 1.0
    for p, q in ((-dx, x-box[0]), (dx, box[2]-x), (-dy, y-box[1]), (dy, box[3]-y)):
        if p == 0:
            if q < 0: return None
        else:
            ratio = q / p
            if p < 0: low = max(low, ratio)
            else: high = min(high, ratio)
            if low > high: return None
    return [[round(x+low*dx, 6), round(y+low*dy, 6)], [round(x+high*dx, 6), round(y+high*dy, 6)]]


def clip_line(points, box):
    lines = []
    for a, b in zip(points, points[1:]):
        segment = clip_segment(a, b, box)
        if not segment or segment[0] == segment[1]: continue
        if lines and lines[-1][-1] == segment[0]: lines[-1].append(segment[1])
        else: lines.append(segment)
    return lines


def read_static(content, box, modes, source):
    """Bounded static import; all stop/shape geography comes from the publisher."""
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        if len(zf.infolist()) > 100 or sum(f.file_size for f in zf.infolist()) > MAX_EXPANDED_BYTES:
            raise ValueError('GTFS archive exceeds limits')
        names = {f.rsplit('/', 1)[-1]: f for f in zf.namelist() if not f.endswith('/')}
        row_count = 0
        def rows(name):
            nonlocal row_count
            if name not in names: return
            with zf.open(names[name]) as raw:
                for row in csv.DictReader(io.TextIOWrapper(raw, 'utf-8-sig')):
                    row_count += 1
                    if row_count > MAX_ROWS: raise ValueError('GTFS row limit exceeded')
                    yield row
        routes = {}
        for r in rows('routes.txt'):
            try: mode = int(r['route_type'])
            except (KeyError, ValueError): continue
            if mode in modes:
                routes[r['route_id']] = {'type': mode, 'short_name': r.get('route_short_name', ''),
                    'long_name': r.get('route_long_name', ''), 'agency_id': r.get('agency_id', ''),
                    'color': r.get('route_color', ''), 'text_color': r.get('route_text_color', '')}
        if 'routes.txt' not in names or 'trips.txt' not in names:
            raise ValueError('GTFS needs routes and trips')
        trips, shape_routes = {}, {}
        for r in rows('trips.txt'):
            rid = r.get('route_id')
            if rid not in routes: continue
            trips[r['trip_id']] = {'route_id': rid, 'shape_id': r.get('shape_id', ''),
                                   'headsign': r.get('trip_headsign', '')}
            if r.get('shape_id'): shape_routes.setdefault(r['shape_id'], set()).add(rid)
        shapes = {}
        for r in rows('shapes.txt'):
            if r.get('shape_id') not in shape_routes: continue
            try:
                lon, lat, seq = float(r['shape_pt_lon']), float(r['shape_pt_lat']), int(r['shape_pt_sequence'])
            except (KeyError, ValueError): continue
            if math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90:
                shapes.setdefault(r['shape_id'], []).append((seq, lon, lat))
        local, features = set(), []
        route_lines, paths = {}, {}
        for sid, points in shapes.items():
            lines = clip_line([[lon, lat] for _, lon, lat in sorted(points)], box)
            if not lines: continue
            paths[sid] = lines
            for rid in shape_routes[sid]:
                local.add(rid); route_lines.setdefault(rid, []).extend(lines)
        local_stops, stop_names = set(), {}
        for r in rows('stops.txt'):
            stop_id = r.get('stop_id')
            if not stop_id: continue
            stop_names[stop_id] = r.get('stop_name', '')
            try: inside = point_inside(float(r['stop_lon']), float(r['stop_lat']), box)
            except (KeyError, ValueError): continue
            if inside: local_stops.add(stop_id)
        # Stops identify routes when publisher shapes are absent or incomplete.
        needs_local = len(local) < len(routes)
        if needs_local or any(not trip['headsign'] for trip in trips.values()):
            trip_end = {}
            for r in rows('stop_times.txt'):
                trip = trips.get(r.get('trip_id'))
                if not trip: continue
                if needs_local and r.get('stop_id') in local_stops: local.add(trip['route_id'])
                if trip['headsign']: continue
                try: sequence = int(r['stop_sequence'])
                except (KeyError, ValueError): continue
                tid = r['trip_id']
                if tid not in trip_end or sequence > trip_end[tid][0]:
                    trip_end[tid] = (sequence, r.get('stop_headsign') or stop_names.get(r.get('stop_id'), ''))
            for tid, (_, headsign) in trip_end.items():
                trips[tid]['headsign'] = headsign
        for rid, lines in route_lines.items():
            unique = list({tuple(map(tuple, line)): line for line in lines}.values())
            r = routes[rid]
            features.append({'type': 'Feature', 'id': source['name']+':'+rid,
                'geometry': {'type': 'MultiLineString', 'coordinates': unique},
                'properties': {'id': source['name']+':'+rid, 'route_id': rid, 'route_type': r['type'],
                    'route_short_name': r['short_name'], 'route_long_name': r['long_name'],
                    'feed': source['name'], 'agency_id': r['agency_id'], 'attribution': source['label'],
                    'route_color': '#'+r['color'] if re.fullmatch('[0-9A-Fa-f]{6}', r['color']) else '#8C8C8C',
                    'route_text_color': '#'+r['text_color'] if re.fullmatch('[0-9A-Fa-f]{6}', r['text_color']) else '#F2F2F2'}})
        return routes, trips, local, {'type': 'FeatureCollection', 'features': features}, paths


def normalize_vehicles(message, routes, trips, local, source, box, now=None, paths=None, previous_positions=None):
    now = time.time() if now is None else now
    if not message.IsInitialized() or message.header.incrementality != gtfs_realtime_pb2.FeedHeader.FULL_DATASET:
        raise ValueError('GTFS realtime requires a complete initialized snapshot')
    # A fresh HTTP response is not proof of fresh publisher observations.
    if not message.header.HasField('timestamp') or not -30 <= now-message.header.timestamp <= 90:
        raise ValueError('GTFS feed timestamp missing, stale or future')
    entities, current_positions = [], {}
    for e in message.entity:
        if not e.HasField('vehicle') or not e.vehicle.HasField('position'): continue
        v, pos = e.vehicle, e.vehicle.position
        if not point_inside(pos.longitude, pos.latitude, box): continue
        trip = trips.get(v.trip.trip_id, {})
        rid = v.trip.route_id or trip.get('route_id', '')
        info = routes.get(rid)
        if not info or rid not in local: continue
        mode = info['type']
        is_bus = mode == 3 or 700 <= mode <= 799 or mode == 800
        if not is_bus and mode not in {0, 1, 2} and not 100 <= mode <= 199 and not 400 <= mode <= 499: continue
        ts = v.timestamp if v.HasField('timestamp') else None
        if ts is not None and not -30 <= now-ts <= 90: continue
        vid = v.vehicle.id or e.id
        if not vid: continue
        bearing = pos.bearing if pos.HasField('bearing') and math.isfinite(pos.bearing) and 0 <= pos.bearing <= 360 else None
        speed_mps = pos.speed if pos.HasField('speed') and math.isfinite(pos.speed) and pos.speed >= 0 else None
        speed_inferred = False
        position_key = (vid, v.trip.trip_id)
        if ts is not None and previous_positions is not None:
            previous = previous_positions.get(position_key)
            if previous:
                old_lon, old_lat, old_ts, old_speed = previous
                delta = ts-old_ts
                if 0 < delta <= 90:
                    meters_lon = 111_320 * max(0.2, abs(math.cos(math.radians(pos.latitude))))
                    distance = math.hypot((pos.longitude-old_lon)*meters_lon,
                                          (pos.latitude-old_lat)*110_540)
                    inferred = distance/delta
                    if 8 <= distance and 1 <= inferred <= (35 if is_bus else 50):
                        if speed_mps is None or speed_mps < 1:
                            speed_mps, speed_inferred = inferred, True
                elif delta == 0 and old_lon == pos.longitude and old_lat == pos.latitude and old_speed is not None:
                    if speed_mps is None or speed_mps < 1:
                        speed_mps, speed_inferred = old_speed, old_speed >= 1
            current_positions[position_key] = (pos.longitude, pos.latitude, ts, speed_mps)
        shape_id = trip.get('shape_id', '') if trip.get('route_id') == rid else ''
        path = motion_path(pos.longitude, pos.latitude, bearing, speed_mps,
                           (paths or {}).get(shape_id), is_bus) if shape_id and ts is not None else None
        identity = {'vehicle_id': vid, 'vehicle_label': v.vehicle.label or vid, 'route_id': rid,
                    'route_short_name': info['short_name'], 'route_long_name': info['long_name'],
                    'route_type': info['type'], 'trip_id': v.trip.trip_id, 'agency_id': info['agency_id'],
                    'feed': source['name'], 'feed_label': source['label'],
                    'destination': trip.get('headsign', ''), 'shape_id': shape_id,
                    'measurement_time_known': ts is not None, 'speed_inferred': speed_inferred}
        if path:
            identity['motion_path'] = path['points']
            identity['route_match_m'] = path['match_m']
        entities.append({'entity_id': f"gtfs:{source['name']}:{vid}",
            'entity_type': 'bus' if is_bus else 'train',
            'source': 'gtfs_'+source['name'],
            'display_name': f"{info['short_name']} — {v.vehicle.label or vid}".strip(' —'),
            'lat': pos.latitude, 'lon': pos.longitude,
            'heading': bearing,
            'speed': round(speed_mps*1.94384, 1) if speed_mps is not None else None,
            'last_seen': datetime.fromtimestamp(ts or message.header.timestamp, timezone.utc).isoformat(),
            'position_ts': ts, 'position_age_s': max(0, now-ts) if ts is not None else None,
            'position_stale': ts is None,
            'identity': identity,
            'tags': [source['label'], info['short_name']]})
    if previous_positions is not None:
        previous_positions.clear()
        previous_positions.update(current_positions)
    return entities


async def download(client, url, limit, params=None):
    # Credentials never follow redirects to another host.
    try:
        response = await send_pinned_http_request(client, 'GET', url, stream=True,
            max_redirects=0 if params else 3, params=params)
    except httpx.HTTPError as exc:
        raise RuntimeError('Transit request failed ('+type(exc).__name__+')') from None
    try:
        response.raise_for_status()
        chunks, size = [], 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit: raise ValueError('Transit download exceeds limit')
            chunks.append(chunk)
        return b''.join(chunks)
    except httpx.HTTPError as exc:
        raise RuntimeError('Transit request failed ('+type(exc).__name__+')') from None
    finally: await response.aclose()


class GtfsRtPoller(BasePoller):
    """One BasePoller per agency, with independent failure/backoff and freshness."""
    def __init__(self, provider_id='trimet-transit'):
        self.provider_id = provider_id
        self.source = dict(SOURCES[provider_id])
        self.name = 'gtfs_'+self.source['name']
        self.interval = 30 if self.source['realtime_url'] else 3600
        self.routes, self.trips, self.local, self.paths = {}, {}, set(), {}
        self.previous_positions = {}
        self.static_ts = 0
        self.static_retry_at = 0
        self.box = bbox(settings)
        self.modes = {0, 1, 2, 3, *range(100, 200), *range(400, 500), *range(700, 800), 800}
        for field, setting in [('static_url', 'static_setting'), ('realtime_url', 'realtime_setting')]:
            if self.source.get(setting): self.source[field] = getattr(settings, self.source[setting])
        if self.source.get('modes_setting'):
            self.modes = {int(x) for x in getattr(settings, self.source['modes_setting']).split(',') if x.strip().isdigit()}
        if self.source.get('interval_setting'):
            self.interval = max(15, getattr(settings, self.source['interval_setting']))

    async def setup(self):
        # Cache only the bounded parsed index, never credentials or requests.
        self.cache_key = 'cache:transit:' + self.source['name'] + ':index'
        self.paths_key = 'cache:transit:' + self.source['name'] + ':paths'
        self.cache_signature = hashlib.sha256(json.dumps([3, self.source['static_url'], self.box, sorted(self.modes)], sort_keys=True).encode()).hexdigest()
        r = await get_bus()
        raw = await r.get(self.cache_key)
        if raw:
            cached = json.loads(raw)
            age = time.time() - cached.get('ts', 0)
            if cached.get('signature') == self.cache_signature and 0 <= age < 86400 and await r.exists(self.paths_key) and await r.exists('feed:provider:'+self.provider_id+':transit:routes'):
                self.routes, self.trips, self.local = cached['routes'], cached['trips'], set(cached['local'])
                self.paths = {sid.decode() if isinstance(sid, bytes) else sid: json.loads(lines)
                              for sid, lines in (await r.hgetall(self.paths_key)).items()}
                self.static_ts = time.monotonic() - age

    async def poll(self):
        source = self.source
        async with httpx.AsyncClient(timeout=90, headers={'User-Agent': 'Vertex/1.0'}) as client:
            if (time.monotonic()-self.static_ts > 86400 or not self.static_ts) and time.monotonic() >= self.static_retry_at:
                try:
                    content = await download(client, source['static_url'], MAX_ZIP_BYTES)
                    routes, trips, local, shapes, paths = await asyncio.to_thread(read_static, content, self.box, self.modes, source)
                    r = await get_bus()
                    pipe = r.pipeline(transaction=True)
                    pipe.delete(self.paths_key)
                    path_items = list(paths.items())
                    for offset in range(0, len(path_items), 100):
                        batch = path_items[offset:offset+100]
                        pipe.hset(self.paths_key, mapping={sid: json.dumps(lines) for sid, lines in batch})
                    pipe.expire(self.paths_key, 172800)
                    await pipe.execute()
                    self.routes, self.trips, self.local, self.paths = routes, trips, local, paths
                    await set_feed('transit:routes', shapes, provider_id=self.provider_id, broadcast=False)
                    # Keep old route consumers working; endpoint now uses the combined contract.
                    self.static_ts = time.monotonic()
                    if hasattr(self, 'cache_key'):
                        r = await get_bus()
                        await r.set(self.cache_key, json.dumps({'signature': self.cache_signature, 'ts': time.time(),
                            'routes': routes, 'trips': trips, 'local': sorted(local)}), ex=86400)
                except Exception as exc:
                    if not self.static_ts: raise
                    self.static_retry_at = time.monotonic() + 900
                    logger.warning('[%s] schedule refresh delayed (%s); retaining cached index', self.name, type(exc).__name__)
            if not source['realtime_url']: return
            params = {source['key_param']: getattr(settings, source['key'], '')} if source.get('key') else None
            content = await download(client, source['realtime_url'], 8*1024*1024, params)
        message = gtfs_realtime_pb2.FeedMessage(); message.ParseFromString(content)
        entities = normalize_vehicles(message, self.routes, self.trips, self.local, source, self.box,
                                      paths=self.paths, previous_positions=self.previous_positions)
        r = await get_bus()
        current = {e['entity_id'] for e in entities}
        # Include restart survivors. Never clear another agency's live entities.
        previous = {k.decode() if isinstance(k, bytes) else k for k in await r.smembers('transit:entities:'+source['name'])}
        for eid in previous-current:
            await r.delete('entity:'+eid)
            await r.publish('civic:updates', json.dumps({'type': 'entity_remove', 'data': {'entity_id': eid}}))
        await r.delete('transit:entities:'+source['name'])
        if current: await r.sadd('transit:entities:'+source['name'], *current)
        for entity in entities: await publish_entity(entity, ttl=120, record_observation=False)
        await set_feed('transit:vehicles', entities, provider_id=self.provider_id, broadcast=False)
