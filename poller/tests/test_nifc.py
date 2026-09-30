from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from pollers import nifc


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(nifc, 'settings', SimpleNamespace(bbox_min_lat=45,bbox_max_lat=46,
        bbox_min_lon=-123,bbox_max_lon=-122,nifc_perimeter_max_age_days=30))
    monkeypatch.setattr(nifc,'get_bus',AsyncMock(return_value=SimpleNamespace(keys=AsyncMock(return_value=[]))))
    publish=AsyncMock();monkeypatch.setattr(nifc,'set_feed',publish)
    return publish


@pytest.mark.asyncio
async def test_current_perimeters_preserve_distinct_same_named_polygons(monkeypatch,setup):
    geom={'type':'Polygon','coordinates':[[[-122.8,45.4],[-122.6,45.4],[-122.6,45.7],[-122.8,45.4]]]}
    features=[{'geometry':geom,'properties':{'OBJECTID':i,'poly_IncidentName':'Example','poly_GISAcres':100,
        'poly_IRWINID':'fixture-incident'}} for i in [1,2]]
    query=AsyncMock(return_value=features);monkeypatch.setattr(nifc,'query_features',query)
    await nifc.NifcPoller().poll()
    assert len(setup.await_args.args[1]['features'])==2
    assert 'Perimeters_Current' in query.await_args.args[1]
    assert query.await_args.args[2]['inSR']=='4326'


@pytest.mark.asyncio
async def test_failure_keeps_old_perimeters_and_reports_failure(monkeypatch,setup):
    monkeypatch.setattr(nifc,'query_features',AsyncMock(side_effect=ValueError('error payload')))
    with pytest.raises(RuntimeError):await nifc.NifcPoller().poll()
    setup.assert_not_awaited()


@pytest.mark.asyncio
async def test_confirmed_empty_perimeter_query_clears_old_data(monkeypatch,setup):
    monkeypatch.setattr(nifc,'query_features',AsyncMock(return_value=[]))
    await nifc.NifcPoller().poll()
    assert setup.await_args.args[1]['features']==[]


@pytest.mark.asyncio
async def test_only_distant_incidents_need_name_queries(monkeypatch,setup):
    import json
    entities={'near':{'display_name':'Example near','lat':45.3842,'lon':-122.7635},'far':{'display_name':'Example distant','lat':60,'lon':-122}}
    redis=SimpleNamespace(keys=AsyncMock(return_value=list(entities)),get=AsyncMock(side_effect=lambda key:json.dumps(entities[key])))
    monkeypatch.setattr(nifc,'get_bus',AsyncMock(return_value=redis))
    query=AsyncMock(return_value=[]);monkeypatch.setattr(nifc,'query_features',query)
    await nifc.NifcPoller().poll()
    assert query.await_count==2
    supplemental=query.await_args.args[2]['where']
    assert 'EXAMPLE DISTANT' in supplemental and 'EXAMPLE NEAR' not in supplemental


def test_supplemental_queries_obey_encoded_url_budget():
    from urllib.parse import urlencode
    names={f"Example wildfire {i} with spaces and apostrophe's" for i in range(100)}
    batches=list(nifc._name_queries(names,"attr_IncidentTypeCategory = 'WF'"))
    assert len(batches)>1
    for params in batches:
        assert len(urlencode({**params,'resultRecordCount':1000,'resultOffset':20000,'orderByFields':'OBJECTID'}))<=1500
    assert "apostrophe''s" in batches[0]['where']
