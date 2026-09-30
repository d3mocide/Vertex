"""Documented Traveler JSON, timestamp semantics and credential-safe failure handling."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
from pollers import wsdot

REGION = SimpleNamespace(region_lat=45.5, region_lon=-122.7, wsdot_api_key='fixture-access-code',
    bbox_min_lat=45, bbox_max_lat=46.1, bbox_min_lon=-123.2, bbox_max_lon=-122)
LOCATION = {'Latitude': 45.6, 'Longitude': -122.7, 'RoadName': 'I-5', 'Direction': 'Southbound'}


def alert(**extra):
    return {'AlertID': 123, 'StartRoadwayLocation': LOCATION, 'HeadlineDescription': 'All lanes closed due to collision',
        'EventCategory': 'Collision', 'EventStatus': 'Open', 'Priority': 'Highest',
        'LastUpdatedTime': '/Date(1750000000000-0700)/', **extra}


def camera(**extra):
    return {'CameraID': 456, 'CameraLocation': LOCATION, 'Title': 'I-5 at Example Bridge', 'IsActive': True,
            'ImageURL': 'https://www.tripcheck.com/RoadCams/bridge.jpg', **extra}


def test_traveler_alert_preserves_published_start_end_and_update():
    row = wsdot.normalize_incidents([alert(StartTime='/Date(1750000000000-0700)/', EndTime='2025-06-16T00:00:00Z')], REGION)[0]
    assert row['id'] == 'wsdot-travel:123' and row['kind'] == 'closure' and row['unplanned']
    assert row['pubDate'] == row['start'] == '2025-06-15T15:06:40+00:00'
    assert row['sched_end'] == '2025-06-16T00:00:00+00:00'
    assert row['location'] == 'I-5 Southbound'


def test_closed_alert_is_not_a_road_closure():
    assert wsdot.normalize_incidents([alert(EventStatus='Closed')], REGION) == []


@pytest.mark.parametrize('value', [None, 'bad', '2025-01-01T12:00:00', '/Date(invalid)/'])
def test_missing_or_ambiguous_timestamp_is_not_invented(value):
    assert wsdot._iso(value) == ''


def test_camera_uses_api_identity_and_filters_inactive():
    row = wsdot.normalize_cameras([camera()], REGION)[0]
    assert row['id'] == 'wsdot-travel:456' and row['health'] == 'unknown'
    assert wsdot.normalize_cameras([camera(IsActive=False)], REGION) == []


@pytest.mark.parametrize('url', ['http://localhost/camera', 'https://example.invalid/camera',
    'https://wsdot.wa.gov.example.invalid/camera', 'https://user:credential@images.wsdot.wa.gov/camera', 'file:///camera'])
def test_camera_urls_are_restricted_to_publishers(url):
    assert wsdot.normalize_cameras([camera(ImageURL=url)], REGION) == []


@pytest.mark.parametrize('lon,lat', [(-117,48),(None,45),(True,45),(float('nan'),45),(-122,91)])
def test_invalid_or_distant_locations_are_filtered(lon,lat):
    loc = {'Longitude': lon, 'Latitude': lat}
    assert wsdot.normalize_cameras([camera(CameraLocation=loc)], REGION) == []
    assert wsdot.normalize_incidents([alert(StartRoadwayLocation=loc)], REGION) == []


@pytest.mark.asyncio
async def test_uses_documented_api_and_runtime_access_code(monkeypatch):
    read = AsyncMock(return_value=[camera()])
    monkeypatch.setattr(wsdot, 'read_json', read)
    assert await wsdot.fetch_layer(None, 'cameras', REGION) == [camera()]
    assert read.await_args.args[1] == wsdot.BASE + wsdot.ENDPOINTS['cameras']
    assert read.await_args.kwargs['params'] == {'AccessCode': REGION.wsdot_api_key}


@pytest.mark.asyncio
async def test_missing_key_makes_no_request(monkeypatch):
    read = AsyncMock();monkeypatch.setattr(wsdot, 'read_json', read)
    with pytest.raises(ValueError):
        await wsdot.fetch_layer(None, 'incidents', SimpleNamespace(wsdot_api_key=''))
    read.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [{'error':'denied'}, 'denied', [None]])
async def test_invalid_api_response_does_not_become_empty_success(payload,monkeypatch):
    monkeypatch.setattr(wsdot,'read_json',AsyncMock(return_value=payload))
    with pytest.raises(ValueError):
        await wsdot.fetch_layer(None,'incidents',REGION)


@pytest.mark.asyncio
async def test_partial_failure_preserves_other_source_and_never_logs_key(monkeypatch,caplog):
    async def fetch(client,kind,region):
        if kind == 'incidents':
            raise httpx.RequestError('https://example.org/?AccessCode=fixture-access-code')
        return [camera()]
    monkeypatch.setattr(wsdot,'settings',REGION);monkeypatch.setattr(wsdot,'fetch_layer',fetch)
    publish=AsyncMock();monkeypatch.setattr(wsdot,'set_feed',publish)
    await wsdot.WsdotPoller().poll()
    assert publish.await_args.args[0] == 'traffic:cameras'
    assert 'fixture-access-code' not in caplog.text


@pytest.mark.asyncio
async def test_complete_failure_does_not_publish_empty_data(monkeypatch):
    monkeypatch.setattr(wsdot,'fetch_layer',AsyncMock(side_effect=httpx.RequestError('failed')))
    publish=AsyncMock();monkeypatch.setattr(wsdot,'set_feed',publish)
    with pytest.raises(RuntimeError):
        await wsdot.WsdotPoller().poll()
    publish.assert_not_awaited()
