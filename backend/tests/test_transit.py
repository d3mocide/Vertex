import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
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
