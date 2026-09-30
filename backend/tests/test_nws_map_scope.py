"""National WMS tiles must use the effective monitoring footprint, including border areas."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from starlette.requests import Request
from fastapi import Response
from routers import weather

BOX={'min_lon':-123.5,'min_lat':44.8,'max_lon':-121.8,'max_lat':45.9}


def settings(pinned):
    return SimpleNamespace(region_lat=45.3842,region_lon=-122.7635,region_name='Example region',
        region_timezone='America/Los_Angeles', model_fields_set={'region_lat'} if pinned else set(),
        **{'bbox_'+k:v for k,v in BOX.items()})


@pytest.mark.asyncio
async def test_env_scope_overrides_caller_mask_and_retains_tile_bbox(monkeypatch):
    monkeypatch.setattr(weather,'settings',settings(True))
    proxy=AsyncMock(return_value=Response(weather.TRANSPARENT_PNG, media_type="image/png"));monkeypatch.setattr(weather,'_proxy_wms',proxy)
    db=SimpleNamespace(get=AsyncMock())
    request=Request({'type':'http','query_string':b'BBOX=-180,-90,180,90&CRS=EPSG:3857&CLIP=bad&LAYERS=other'})
    await weather.proxy_alerts_wms(request,db)
    params=proxy.await_args.args[1]
    assert params['clip']==weather.alerts_clip(BOX)
    assert params['bbox']=='-180,-90,180,90' and params['crs']=='EPSG:3857'
    assert params['layers']=='alerts:watches_warnings_advisories'
    assert params['format']=='image/png' and params['transparent']=='true'
    db.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_saved_region_scope_includes_both_sides_of_border(monkeypatch):
    monkeypatch.setattr(weather,'settings',settings(False))
    box={**BOX,'max_lat':46.2}
    stored={'lat':45.5,'lon':-122.7,'bbox':box,'name':'Example border','timezone':'America/Los_Angeles'}
    db=SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(value=stored)))
    proxy=AsyncMock(return_value=Response(weather.TRANSPARENT_PNG, media_type="image/png"));monkeypatch.setattr(weather,'_proxy_wms',proxy)
    await weather.proxy_alerts_wms(Request({'type':'http','query_string':b''}),db)
    assert proxy.await_args.args[1]['clip']==weather.alerts_clip(box)
    assert '-121.8 46.2' in proxy.await_args.args[1]['clip']


@pytest.mark.asyncio
async def test_upstream_xml_error_is_a_transparent_tile(monkeypatch):
    from fastapi import Response
    monkeypatch.setattr(weather,'settings',settings(True))
    monkeypatch.setattr(weather,'_proxy_wms',AsyncMock(return_value=Response(b'upstream error',media_type='text/xml')))
    result=await weather.proxy_alerts_wms(Request({'type':'http','query_string':b''}),SimpleNamespace(get=AsyncMock()))
    assert result.body==weather.TRANSPARENT_PNG and result.media_type=='image/png'
