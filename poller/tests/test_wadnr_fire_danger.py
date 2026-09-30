from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from pollers import wadnr_fire_danger as dnr
from pollers import nifc_incidents as nifc
from provider_feeds import merge,provenance

REGION=SimpleNamespace(region_lat=45.5,region_lon=-122.7,bbox_min_lat=45,bbox_max_lat=46.1,bbox_min_lon=-123.2,bbox_max_lon=-122)
POLYGON={'type':'Polygon','coordinates':[[[-122.8,45.4],[-122.6,45.4],[-122.6,45.7],[-122.8,45.7],[-122.8,45.4]]]}


def feature(label='Very High'):
    return {'geometry':POLYGON,'properties':{'OBJECTID':1,'FIREDANGER_AREA_NM':'Example area',
        'FIRE_DANGER_LEVEL_NM':label,'BURN_BAN_LEVEL_NM':'No outdoor burning','DNR_REGION_NAME':'Example district'}}


def test_danger_retains_five_level_label_rank_and_restriction_scope():
    out=dnr.normalize([feature()],REGION)
    assert out['home']['label']=='Very High' and out['home']['danger_rank']==4
    assert 'DNR-protected' in out['home']['scope']
    assert out['home']['burn_ban']=='No outdoor burning'
    extreme=dnr.normalize([feature('Extreme')],REGION)
    assert extreme['home']['danger_rank']==5 and extreme['home']['label']=='Extreme'


def test_unknown_danger_still_preserves_published_burn_restriction():
    out=dnr.normalize([feature('Not Rated')],REGION)
    assert out['home']['danger']==0 and out['home']['label']=='Not Rated'
    assert out['features'][0]['properties']['burn_ban']=='No outdoor burning'


def test_malformed_geometry_is_discarded():
    f=feature();f['geometry']={'type':'Polygon','coordinates':[[[float('nan'),45]]*4]}
    assert dnr.normalize([f],REGION)['features']==[]


def test_oregon_and_washington_fire_snapshots_merge_with_source_labels():
    wa=provenance(dnr.normalize([feature()],REGION),'wadnr-fire-danger','2026-01-01T00:00:00+00:00')
    ore=provenance({'type':'FeatureCollection','features':[{'type':'Feature','geometry':POLYGON,
        'properties':{'zone':'Example Oregon','danger':4}}], 'nearby':[{'zone':'Example Oregon','danger':4,'label':'Extreme','dist_km':20}],
        'home':None},'odf-fire-danger','2026-01-01T00:00:00+00:00')
    merged=merge('fire:danger',[ore,wa])
    assert len(merged['features'])==2 and len(merged['nearby'])==2
    assert {r['attribution'] for r in merged['nearby']}=={'ODF','WA DNR'}
    assert merged['nearby'][0]['burn_ban']=='No outdoor burning'


@pytest.mark.asyncio
async def test_dnr_failure_never_publishes_empty_success(monkeypatch):
    monkeypatch.setattr(dnr,'settings',REGION)
    monkeypatch.setattr(dnr,'query_features',AsyncMock(side_effect=ValueError('error payload')))
    publish=AsyncMock();monkeypatch.setattr(dnr,'set_feed',publish)
    with pytest.raises(ValueError):await dnr.WadnrFireDangerPoller().poll()
    publish.assert_not_awaited()


def test_nifc_incidents_only_include_active_wildfires_with_irwin_identity():
    f={'geometry':{'type':'Point','coordinates':[-122.7,45.6]},'properties':{
        'IrwinID':'{fixture-incident}', 'IncidentTypeCategory':'WF','ActiveFireCandidate':1,
        'IncidentName':'Example Fire','PercentContained':25,'IncidentSize':100,'ModifiedOnDateTime_dt':1750000000000}}
    rows=nifc.normalize([f],REGION)
    assert rows[0]['id']=='fixture-incident' and rows[0]['contained_pct']==25
    for key,value in [('IncidentTypeCategory','RX'),('ActiveFireCandidate',0),('IrwinID',None)]:
        bad={**f,'properties':{**f['properties'],key:value}}
        assert nifc.normalize([bad],REGION)==[]


@pytest.mark.parametrize('value', [None, True, -1, float('nan'), float('inf'), 'unknown'])
def test_nifc_invalid_measurements_remain_unknown(value):
    assert nifc._number(value) is None


def test_nifc_containment_has_valid_percentage_range():
    assert nifc._number(101,100) is None
    assert nifc._number(25,100)==25
