import io
import zipfile
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.transit import gtfs_realtime_pb2 as pb
from pollers import gtfs_rt as g

BOX = (-123.5, 44.8, -121.8, 45.9)  # Generic .env.example bounds.
SOURCE = {'name': 'example', 'label': 'Example Transit'}
NOW = 1800000000


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    monkeypatch.setattr(g, 'settings', SimpleNamespace(bbox_min_lon=BOX[0], bbox_min_lat=BOX[1],
        bbox_max_lon=BOX[2], bbox_max_lat=BOX[3], trimet_gtfs_static_url='https://example.com/static.zip',
        trimet_gtfs_rt_url='https://example.com/vehicles.pb', trimet_route_types='0,3',
        trimet_poll_interval=15, trimet_app_id='fixture-key'))


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as z:
        for name, data in files.items(): z.writestr(name, data)
    return buffer.getvalue()


def fixture():
    return archive({
        'routes.txt': 'route_id,route_type,route_short_name,route_long_name\nr1,3,1,Example Bus\nr2,0,2,Example Tram\n',
        'trips.txt': 'trip_id,route_id,shape_id,trip_headsign\nt1,r1,s1,Downtown\nt2,r2,s2,Campus\n',
        'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,45.3842,-124,1\ns1,45.3842,-121,2\n',
        'stops.txt': 'stop_id,stop_lat,stop_lon\nstop,45.3842,-122.7635\n',
        'stop_times.txt': 'trip_id,stop_id\nt2,stop\n',
    })


def message():
    m = pb.FeedMessage();m.header.gtfs_realtime_version='2.0';m.header.timestamp=NOW
    for i, rid in enumerate(['r1', 'r2']):
        e=m.entity.add();e.id=str(i);v=e.vehicle
        v.trip.route_id=rid;v.trip.trip_id='t'+str(i+1);v.vehicle.id='same'+str(i)
        v.position.latitude=45.3842;v.position.longitude=-122.7635
        v.position.speed=0;v.position.bearing=0;v.timestamp=NOW-10
    return m


def normalize(m=None, source=SOURCE):
    routes,trips,local,_,paths=g.read_static(fixture(),BOX,{0,3},SOURCE)
    return g.normalize_vehicles(m or message(),routes,trips,local,source,BOX,NOW,paths)


def test_shapes_cross_area_without_vertices_inside_and_stops_supply_missing_shapes():
    routes,trips,local,geo,paths=g.read_static(fixture(),BOX,{0,3},SOURCE)
    assert local=={'r1','r2'} and trips['t2']['route_id']=='r2'
    line=geo['features'][0]['geometry']['coordinates'][0]
    assert line[0][0]==BOX[0] and line[-1][0]==BOX[2]
    assert geo['features'][0]['properties']['route_type']==3


def test_bus_and_train_are_distinct_and_zero_speed_heading_preserved():
    bus,train=normalize()
    assert bus['entity_type']=='bus' and train['entity_type']=='train'
    assert bus['speed']==0 and bus['heading']==0 and bus['position_age_s']==10
    assert bus['entity_id']=='gtfs:example:same0'
    assert bus['identity']['destination']=='Downtown'
    assert bus['identity']['shape_id']=='s1'


def test_motion_path_needs_matching_trip_shape_heading_and_measured_speed():
    m=message()
    m.entity[0].vehicle.position.speed=10
    m.entity[0].vehicle.position.bearing=90
    bus=normalize(m)[0]
    path=bus['identity']['motion_path']
    assert len(path)>=2 and path[0][0]<path[-1][0]
    assert 0 <= bus['identity']['route_match_m'] < 45
    m.entity[0].vehicle.position.bearing=270
    assert 'motion_path' not in normalize(m)[0]['identity']
    m.entity[0].vehicle.position.bearing=90
    m.entity[0].vehicle.position.latitude+=0.01
    assert 'motion_path' not in normalize(m)[0]['identity']
    m.entity[0].vehicle.position.latitude-=0.01
    m.entity[0].vehicle.ClearField('timestamp')
    assert 'motion_path' not in normalize(m)[0]['identity']


def test_missing_headsign_uses_final_scheduled_stop():
    content=archive({
        'routes.txt': 'route_id,route_type,route_short_name\nr1,3,1\n',
        'trips.txt': 'trip_id,route_id,shape_id\nt1,r1,s1\n',
        'shapes.txt': 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\ns1,45.3842,-123,1\ns1,45.3842,-122,2\n',
        'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\na,First,45.3842,-122.8\nb,Terminal,45.3842,-122.7\n',
        'stop_times.txt': 'trip_id,stop_id,stop_sequence\nt1,a,1\nt1,b,2\n',
    })
    _,trips,_,_,_=g.read_static(content,BOX,{3},SOURCE)
    assert trips['t1']['headsign']=='Terminal'


def test_missing_realtime_speed_uses_consecutive_measured_fixes():
    routes,trips,local,_,paths=g.read_static(fixture(),BOX,{0,3},SOURCE)
    positions={}
    first=message()
    first.entity[0].vehicle.position.bearing=90
    initial=g.normalize_vehicles(first,routes,trips,local,SOURCE,BOX,NOW,paths,positions)[0]
    assert 'motion_path' not in initial['identity']
    second=message()
    second.entity[0].vehicle.timestamp=NOW
    second.entity[0].vehicle.position.longitude+=0.001
    second.entity[0].vehicle.position.bearing=90
    moved=g.normalize_vehicles(second,routes,trips,local,SOURCE,BOX,NOW,paths,positions)[0]
    assert moved['identity']['speed_inferred'] is True
    assert moved['speed'] > 1
    assert len(moved['identity']['motion_path']) >= 2
    jump=message()
    jump.header.timestamp=NOW+15
    jump.entity[0].vehicle.timestamp=NOW+15
    jump.entity[0].vehicle.position.longitude+=0.02
    jump.entity[0].vehicle.position.bearing=90
    implausible=g.normalize_vehicles(jump,routes,trips,local,SOURCE,BOX,NOW+15,paths,positions)[0]
    assert implausible['identity']['speed_inferred'] is False
    assert 'motion_path' not in implausible['identity']


def test_feed_namespace_prevents_vehicle_id_collisions():
    a=normalize()[0];b=normalize(source={'name':'other','label':'Other Transit'})[0]
    assert a['entity_id']!=b['entity_id']


def test_trip_resolves_route_when_realtime_route_id_absent():
    m=message();m.entity[0].vehicle.trip.ClearField('route_id')
    assert normalize(m)[0]['identity']['route_id']=='r1'


@pytest.mark.parametrize('offset', [-100, 100])
def test_stale_or_future_feed_cannot_refresh_success(offset):
    m=message();m.header.timestamp=NOW+offset
    with pytest.raises(ValueError):normalize(m)


def test_missing_header_timestamp_is_not_a_success():
    m=message();m.header.ClearField('timestamp')
    with pytest.raises(ValueError):normalize(m)


def test_stale_vehicle_and_out_of_region_vehicle_are_removed_from_snapshot():
    m=message();m.entity[0].vehicle.timestamp=NOW-91;m.entity[1].vehicle.position.latitude=49
    assert normalize(m)==[]


def test_missing_measurement_timestamp_is_explicitly_unknown():
    m=message();m.entity[0].vehicle.ClearField('timestamp')
    e=normalize(m)[0]
    assert e['position_ts'] is None and e['position_stale'] and not e['identity']['measurement_time_known']


def test_nan_coordinates_are_rejected():
    m=message();m.entity[0].vehicle.position.latitude=float('nan')
    assert len(normalize(m))==1


def test_fresh_empty_snapshot_and_differential_rejection():
    m=message();del m.entity[:]
    assert normalize(m)==[]
    m.header.incrementality=pb.FeedHeader.DIFFERENTIAL
    with pytest.raises(ValueError):normalize(m)


def test_static_limits_and_mode_filter(monkeypatch):
    _,_,local,geo,_=g.read_static(fixture(),BOX,{0},SOURCE)
    assert local=={'r2'} and not geo['features']
    monkeypatch.setattr(g,'MAX_EXPANDED_BYTES',1)
    with pytest.raises(ValueError):g.read_static(fixture(),BOX,{0,3},SOURCE)


@pytest.mark.asyncio
async def test_successful_empty_snapshot_removes_only_its_own_previous_entities(monkeypatch):
    collector=g.GtfsRtPoller('trimet-transit');collector.static_ts=g.time.monotonic()
    m=message();del m.entity[:];m.header.timestamp=int(g.time.time())
    monkeypatch.setattr(g,'download',AsyncMock(return_value=m.SerializeToString()))
    redis=SimpleNamespace(smembers=AsyncMock(return_value={'gtfs:trimet:old'}),delete=AsyncMock(),
        publish=AsyncMock(),sadd=AsyncMock())
    monkeypatch.setattr(g,'get_bus',AsyncMock(return_value=redis))
    feed=AsyncMock();monkeypatch.setattr(g,'set_feed',feed)
    await collector.poll()
    redis.delete.assert_any_await('entity:gtfs:trimet:old')
    redis.publish.assert_awaited_once()
    feed.assert_awaited_once_with('transit:vehicles',[],provider_id='trimet-transit',broadcast=False)


@pytest.mark.asyncio
async def test_failed_fetch_preserves_snapshot_and_cannot_publish_freshness(monkeypatch):
    collector=g.GtfsRtPoller('trimet-transit');collector.static_ts=g.time.monotonic()
    monkeypatch.setattr(g,'download',AsyncMock(side_effect=RuntimeError('Request failed')))
    feed=AsyncMock();monkeypatch.setattr(g,'set_feed',feed)
    with pytest.raises(RuntimeError):await collector.poll()
    feed.assert_not_awaited()


@pytest.mark.asyncio
async def test_cached_index_restores_original_age_without_marking_routes_fresh(monkeypatch):
    import hashlib
    import json
    collector = g.GtfsRtPoller('trimet-transit')
    signature = hashlib.sha256(json.dumps([3, collector.source['static_url'], collector.box,
        sorted(collector.modes)], sort_keys=True).encode()).hexdigest()
    cached = {'signature': signature, 'ts': g.time.time()-3600,
        'routes': {'r1': {'type': 3}}, 'trips': {'t1': {'route_id': 'r1'}}, 'local': ['r1']}
    redis = SimpleNamespace(get=AsyncMock(return_value=json.dumps(cached)),
        hscan=AsyncMock(side_effect=[(7, {'s1': json.dumps([[[0, 0], [1, 1]]])}), (0, {'s2': json.dumps([[[0, 0], [2, 2]]])})]), exists=AsyncMock(return_value=True))
    monkeypatch.setattr(g, 'get_bus', AsyncMock(return_value=redis))
    await collector.setup()
    assert redis.hscan.await_count == 2
    assert set(collector.paths) == {'s1', 's2'}
    assert collector.local == {'r1'} and collector.trips == {'t1': {'route_id': 'r1'}}
    assert 3599 <= g.time.monotonic()-collector.static_ts <= 3601


@pytest.mark.asyncio
async def test_schedule_refresh_failure_keeps_index_and_continues_live_feed(monkeypatch):
    collector = g.GtfsRtPoller('trimet-transit')
    collector.static_ts = g.time.monotonic()-90000
    m = message(); del m.entity[:]; m.header.timestamp=int(g.time.time())
    monkeypatch.setattr(g, 'run_static_job', AsyncMock(side_effect=RuntimeError('Unavailable')))   # the schedule is built in a child process
    monkeypatch.setattr(g, 'download', AsyncMock(return_value=m.SerializeToString()))
    redis = SimpleNamespace(smembers=AsyncMock(return_value=set()), delete=AsyncMock(), sadd=AsyncMock())
    monkeypatch.setattr(g, 'get_bus', AsyncMock(return_value=redis))
    feed=AsyncMock(); monkeypatch.setattr(g, 'set_feed', feed)
    await collector.poll()
    feed.assert_awaited_once_with('transit:vehicles', [], provider_id='trimet-transit',broadcast=False)
    assert collector.static_retry_at > g.time.monotonic()


@pytest.mark.asyncio
async def test_cache_timeout_falls_back_without_terminating_startup(monkeypatch):
    from redis.exceptions import TimeoutError
    collector = g.GtfsRtPoller()
    redis = SimpleNamespace(get=AsyncMock(side_effect=TimeoutError('cache response timeout')))
    monkeypatch.setattr(g, 'get_bus', AsyncMock(return_value=redis))
    pause = AsyncMock(); monkeypatch.setattr(g.asyncio, 'sleep', pause)
    await collector.setup()
    assert collector.static_ts == 0
    assert collector.paths == {}
    assert redis.get.await_count == 2 and pause.await_count == 1   # one retry after a pause, then fall back to a rebuild


def test_packed_shapes_round_trip_and_old_list_form_still_works():
    from pollers import gtfs_rt
    lines = [[[-122.5, 45.5], [-122.4, 45.6], [-122.3, 45.7]], [[-122.0, 45.0], [-121.9, 45.1]]]
    packed = gtfs_rt.pack_lines(lines)
    assert all(isinstance(p, gtfs_rt.array) for p in packed)
    assert [[list(pt) for pt in line] for line in gtfs_rt.unpack_lines(packed)] == lines
    assert gtfs_rt.unpack_lines(lines) == lines            # lines that were never packed pass through
    assert gtfs_rt._shape_lines(None, {}, "x") is None and gtfs_rt._shape_lines({"a": packed}, {}, "b") is None
    cache = {}
    assert gtfs_rt._shape_lines({"a": packed}, cache, "a") is gtfs_rt._shape_lines({"a": packed}, cache, "a")
