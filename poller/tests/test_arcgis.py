from unittest.mock import AsyncMock
import httpx
import pytest
import arcgis


@pytest.mark.asyncio
async def test_pagination_reads_all_pages_and_scopes_bbox(monkeypatch):
    read=AsyncMock(side_effect=[{'type':'FeatureCollection','features':[{'id':1}], 'exceededTransferLimit':True},
        {'type':'FeatureCollection','features':[{'id':2}]}])
    monkeypatch.setattr(arcgis,'read_json',read)
    rows=await arcgis.query_features(None,'https://example.org/query',{'geometry':'fixture-envelope','inSR':4326})
    assert len(rows)==2
    assert [c.kwargs['params']['resultOffset'] for c in read.await_args_list]==[0,1000]
    assert all(c.kwargs['params']['geometry']=='fixture-envelope' for c in read.await_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize('payload',[{'error':{'code':500}}, {'type':'FeatureCollection','features':'bad'},
    {'type':'FeatureCollection','features':[], 'exceededTransferLimit':True},
    {'type':'FeatureCollection','features':[None]}, {'type':'FeatureCollection','features':[], 'properties':'bad'}])
async def test_errors_do_not_replace_retained_data_with_empty_success(monkeypatch,payload):
    monkeypatch.setattr(arcgis,'read_json',AsyncMock(return_value=payload))
    with pytest.raises(ValueError):
        await arcgis.query_features(None,'https://example.org/query',{})


@pytest.mark.asyncio
async def test_size_bound_and_response_closed(monkeypatch):
    response=httpx.Response(200,content=b'01234567890',request=httpx.Request('GET','https://example.org'))
    monkeypatch.setattr(arcgis,'send_pinned_http_request',AsyncMock(return_value=response))
    monkeypatch.setattr(arcgis,'MAX_RESPONSE_BYTES',10)
    with pytest.raises(ValueError,match='size limit'):
        await arcgis.read_json(None,'https://example.org')
    assert response.is_closed


@pytest.mark.asyncio
async def test_pagination_limit(monkeypatch):
    monkeypatch.setattr(arcgis,'MAX_PAGES',1)
    monkeypatch.setattr(arcgis,'read_json',AsyncMock(return_value={'type':'FeatureCollection','features':[{}], 'exceededTransferLimit':True}))
    with pytest.raises(ValueError,match='record limit'):
        await arcgis.query_features(None,'https://example.org/query',{})


@pytest.mark.asyncio
async def test_total_collection_size_is_bounded_across_pages(monkeypatch):
    monkeypatch.setattr(arcgis,'MAX_TOTAL_BYTES',10)
    monkeypatch.setattr(arcgis,'read_json',AsyncMock(return_value={'type':'FeatureCollection','features':[{'name':'oversized fixture'}]}))
    with pytest.raises(ValueError,match='total size limit'):
        await arcgis.query_features(None,'https://example.org/query',{})
