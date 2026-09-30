"""Setup station discovery, identifier validation and region-owned alert zones."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
import pytest
import nws_resolver
import region_config
import region_alerts
from nws_defaults import zone_changes

LAT, LON = 45.3842, -122.7635
BOX = {'min_lat':44.8,'max_lat':45.9,'min_lon':-123.5,'max_lon':-121.8}


def station(ident, delta):
    return {'geometry':{'type':'Point','coordinates':[LON+delta,LAT]},'properties':{'stationIdentifier':ident}}


def test_station_ranking_climate_inventory_and_invalid_geometry():
    out = nws_resolver.station_choices({'features':[station('KAAA',.1),station('KBBB',.2),station('KCCC',3),station('../bad',0),station('KDDD',float('nan'))]},LAT,LON,{'BBB':'Example climate'})
    assert out == {'station_primary':'KAAA','station_secondary':'KBBB','nearby_stations':['KBBB'],'climate_station':'BBB'}
    assert nws_resolver.station_choices({},LAT,LON,{})['climate_station']==''


@pytest.mark.asyncio
async def test_station_lookup_is_optional_and_only_follows_official_station_urls():
    client=SimpleNamespace(get=AsyncMock())
    out=await nws_resolver.resolve_stations({'observationStations':'https://example.invalid/stations'},LAT,LON,client)
    assert out['station_primary']=='' and out['station_warning']
    client.get.assert_not_awaited()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(503))) as client:
        out=await nws_resolver.resolve_stations({'observationStations':'https://api.weather.gov/gridpoints/PQR/1,2/stations'},LAT,LON,client)
    assert out['station_primary']=='' and out['climate_station']=='' and out['station_warning']


@pytest.mark.asyncio
async def test_station_lookup_uses_cf6_inventory():
    def handler(req):
        if '/gridpoints/' in req.url.path:return httpx.Response(200,json={'features':[station('KAAA',.1),station('KBBB',.2)]})
        return httpx.Response(200,json={'locations':{'BBB':None}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        out=await nws_resolver.resolve_stations({'observationStations':'https://api.weather.gov/gridpoints/PQR/1,2/stations'},LAT,LON,client)
    assert out['station_primary']=='KAAA' and out['climate_station']=='BBB'


def test_normalize_station_choices_rejects_path_identifiers_and_keeps_unresolved_values():
    region={'name':'Example region','lat':LAT,'lon':LON,'bbox':BOX,'timezone':'America/Los_Angeles'}
    nws={'station_primary':'KAAA','station_secondary':'','nearby_stations':['KBBB'],'climate_station':''}
    assert region_config.normalize({**region,'nws':nws})['nws']==nws
    with pytest.raises(region_config.RegionError):region_config.normalize({**region,'nws':{'station_primary':'../other'}})
    with pytest.raises(region_config.RegionError):region_config.normalize({**region,'nws':{'nearby_stations':'KAAA'}})


def test_region_zones_preserve_operator_config_and_disabled_rows():
    rows=[{'zone_code':'ORZ109','source':'user','enabled':False},{'zone_code':'ORC067','source':'config'},{'zone_code':'ORZ001','source':'region'}]
    nws={'forecast_zone':'ORZ109','county_zone':'ORC067','fire_zone':'ORZ684'}
    assert zone_changes(nws,rows)==(['ORZ684'],['ORZ001'])
    assert zone_changes(nws,rows,True)==([],['ORZ001'])


@pytest.mark.asyncio
async def test_database_zone_reconcile_only_changes_owned_rows(monkeypatch):
    old=SimpleNamespace(zone_code='ORZ001',source='region')
    operator=SimpleNamespace(zone_code='ORZ109',source='user',enabled=False)
    from unittest.mock import Mock
    db=SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda:SimpleNamespace(all=lambda:[old,operator]))),delete=AsyncMock(),add=Mock())
    monkeypatch.setattr(region_alerts,'settings',SimpleNamespace(model_fields_set=set()))
    await region_alerts.sync_region_zones(db,{'forecast_zone':'ORZ109','fire_zone':'ORZ684'})
    db.delete.assert_awaited_once_with(old)
    assert db.add.call_args.args[0].zone_code=='ORZ684' and db.add.call_args.args[0].source=='region'
    assert not operator.enabled
