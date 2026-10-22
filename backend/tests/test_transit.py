import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from routers import rail


@pytest.mark.asyncio
async def test_combined_route_endpoint_and_rail_compatibility_exclude_bus_paths(monkeypatch):
    collection={'type':'FeatureCollection','features':[
        {'type':'Feature','properties':{'route_type':0,'provider_id':'example-a'}},
        {'type':'Feature','properties':{'route_type':3,'provider_id':'example-b'}},
        {'type':'Feature','properties':{'route_type':700,'provider_id':'example-b'}}]}
    redis=SimpleNamespace(get=AsyncMock(return_value=json.dumps(collection)))
    monkeypatch.setattr(rail,'get_redis',lambda:redis)
    assert len((await rail.get_transit_routes())['features'])==3
    assert (await rail.get_gtfs_shapes())['features']==collection['features'][:1]
    redis.get.return_value=None
    assert (await rail.get_transit_routes())['features']==[]
    assert await rail.get_transit_vehicles()==[]


@pytest.mark.asyncio
async def test_trip_shape_is_selected_by_reviewed_feed_and_shape_id(monkeypatch):
    paths={'shape-a': [[[0, 0], [1, 1]]]}
    redis=SimpleNamespace(hget=AsyncMock(side_effect=lambda _, key: json.dumps(paths.get(key)) if key in paths else None))
    monkeypatch.setattr(rail,'get_redis',lambda:redis)
    response=await rail.get_transit_trip_shape('trimet','shape-a')
    assert response['coordinates']==paths['shape-a']
    redis.hget.assert_awaited_with('cache:transit:trimet:paths','shape-a')
    with pytest.raises(HTTPException):
        await rail.get_transit_trip_shape('unknown','shape-a')
    with pytest.raises(HTTPException):
        await rail.get_transit_trip_shape('trimet','missing')


INDEX = {'stops': {'a': ['Alpha', 45.4, -122.7], 'b': ['Beta', 45.41, -122.71]},
         'routes': {'r1': [{'h': 'Downtown', 's': ['a', 'b']}], 'r2': [{'h': 'Loop', 's': ['b']}]}}


def _route(rid, number, type_=3):
    return {'type': 'Feature', 'geometry': {'type': 'MultiLineString', 'coordinates': [[[0, 0], [1, 1]]]},
            'properties': {'id': 'trimet:' + rid, 'feed': 'trimet', 'route_id': rid, 'route_type': type_,
                           'route_short_name': number, 'route_long_name': 'Line ' + rid, 'route_color': '#112233'}}


def _redis(monkeypatch):
    routes = {'type': 'FeatureCollection', 'features': [_route('r2', '10'), _route('r1', '9'), _route('r3', '90', 0)]}
    data = {'feed:transit:routes': json.dumps(routes), 'cache:transit:trimet:stops': json.dumps(INDEX)}
    redis = SimpleNamespace(get=AsyncMock(side_effect=lambda key: data.get(key)))
    monkeypatch.setattr(rail, 'get_redis', lambda: redis)


@pytest.mark.asyncio
async def test_route_list_has_no_geometry_and_sorts_by_agency_mode_then_number(monkeypatch):
    _redis(monkeypatch)
    listed = await rail.get_transit_route_list()
    assert [r['route_id'] for r in listed] == ['r3', 'r1', 'r2']          # tram first, then 9 before 10
    assert all('geometry' not in r for r in listed)


@pytest.mark.asyncio
async def test_route_detail_lists_ordered_stops_and_geometry(monkeypatch):
    _redis(monkeypatch)
    detail = await rail.get_transit_route('trimet', 'r1')
    assert detail['directions'] == [{'headsign': 'Downtown', 'stops': [
        {'id': 'a', 'name': 'Alpha', 'lat': 45.4, 'lon': -122.7}, {'id': 'b', 'name': 'Beta', 'lat': 45.41, 'lon': -122.71}]}]
    assert detail['geometry']['type'] == 'MultiLineString' and detail['route']['route_id'] == 'r1'
    with pytest.raises(HTTPException):
        await rail.get_transit_route('trimet', 'nope')
    with pytest.raises(HTTPException):
        await rail.get_transit_route('unknown', 'r1')


@pytest.mark.asyncio
async def test_stop_lists_the_routes_that_call_there(monkeypatch):
    _redis(monkeypatch)
    stop = await rail.get_transit_stop('trimet', 'b')
    assert stop['name'] == 'Beta' and [r['route_id'] for r in stop['routes']] == ['r1', 'r2']
    assert [r['route_id'] for r in (await rail.get_transit_stop('trimet', 'a'))['routes']] == ['r1']
    with pytest.raises(HTTPException):
        await rail.get_transit_stop('trimet', 'zzz')
