from unittest.mock import AsyncMock
from types import SimpleNamespace
import pytest
from pollers import arcgis_fire_danger as arc
from provider_catalog import CONTRACT_IDS, register_declared   # also puts the shared region support on the import path
import pack_support
from provider_feeds import merge,provenance

import os
REGIONS_DIR=os.environ.get('REGION_PACKS_DIR',os.path.join(os.path.dirname(__file__),'..','..','regions'))
REGION=SimpleNamespace(region_lat=45.5,region_lon=-122.7,bbox_min_lat=45,bbox_max_lat=46.1,bbox_min_lon=-123.2,bbox_max_lon=-122)
def _washington_spec():
    pack={p['id']:p for p in pack_support.discover(REGIONS_DIR,CONTRACT_IDS)}['washington']
    register_declared(pack)    # what the provider plan does at startup
    return next(p['spec'] for p in pack['providers'] if p['id']=='wadnr-fire-danger')


SPEC=_washington_spec()
POLYGON={'type':'Polygon','coordinates':[[[-122.8,45.4],[-122.6,45.4],[-122.6,45.7],[-122.8,45.7],[-122.8,45.4]]]}


def feature(label='Very High'):
    return {'geometry':POLYGON,'properties':{'OBJECTID':1,'FIREDANGER_AREA_NM':'Example area',
        'FIRE_DANGER_LEVEL_NM':label,'BURN_BAN_LEVEL_NM':'No outdoor burning','DNR_REGION_NAME':'Example district'}}


def test_danger_retains_five_level_label_rank_and_restriction_scope():
    out=arc.normalize([feature()],SPEC,REGION,'wadnr-fire-danger')
    assert out['home']['label']=='Very High' and out['home']['danger_rank']==4
    assert 'DNR-protected' in out['home']['scope']
    assert out['home']['burn_ban']=='No outdoor burning'
    extreme=arc.normalize([feature('Extreme')],SPEC,REGION,'wadnr-fire-danger')
    assert extreme['home']['danger_rank']==5 and extreme['home']['label']=='Extreme'


def test_unknown_danger_still_preserves_published_burn_restriction():
    out=arc.normalize([feature('Not Rated')],SPEC,REGION,'wadnr-fire-danger')
    assert out['home']['danger']==0 and out['home']['label']=='Not Rated'
    assert out['features'][0]['properties']['burn_ban']=='No outdoor burning'


def test_malformed_geometry_is_discarded():
    f=feature();f['geometry']={'type':'Polygon','coordinates':[[[float('nan'),45]]*4]}
    assert arc.normalize([f],SPEC,REGION,'wadnr-fire-danger')['features']==[]


def test_oregon_and_washington_fire_snapshots_merge_with_source_labels():
    wa=provenance(arc.normalize([feature()],SPEC,REGION,'wadnr-fire-danger'),'wadnr-fire-danger','2026-01-01T00:00:00+00:00')
    ore=provenance({'type':'FeatureCollection','features':[{'type':'Feature','geometry':POLYGON,
        'properties':{'zone':'Example Oregon','danger':4}}], 'nearby':[{'zone':'Example Oregon','danger':4,'label':'Extreme','dist_km':20}],
        'home':None},'odf-fire-danger','2026-01-01T00:00:00+00:00')
    merged=merge('fire:danger',[ore,wa])
    assert len(merged['features'])==2 and len(merged['nearby'])==2
    assert {r['attribution'] for r in merged['nearby']}=={'ODF','WA DNR'}
    assert merged['nearby'][0]['burn_ban']=='No outdoor burning'


@pytest.mark.asyncio
async def test_failure_never_publishes_empty_success(monkeypatch):
    monkeypatch.setattr(arc,'settings',REGION)
    monkeypatch.setattr(arc,'query_features',AsyncMock(side_effect=ValueError('error payload')))
    publish=AsyncMock();monkeypatch.setattr(arc,'set_feed',publish)
    with pytest.raises(ValueError):await arc.ArcgisFireDangerPoller('wadnr-fire-danger',SPEC).poll()
    publish.assert_not_awaited()


def test_unknown_levels_can_be_skipped_for_agencies_that_publish_only_known_codes():
    spec={**SPEC,'skip_unknown':True}
    assert arc.normalize([feature('Not Rated')],spec,REGION,'x')['features']==[]
    assert len(arc.normalize([feature()],spec,REGION,'x')['features'])==1


def test_numeric_codes_and_labels_follow_the_manifest():
    spec={**SPEC,'fields':{**SPEC['fields'],'level':'CODE'},'levels':{'3':{'danger':3,'rank':3,'label':'High'}}}
    f={'geometry':POLYGON,'properties':{'OBJECTID':2,'FIREDANGER_AREA_NM':'Z','CODE':3}}
    out=arc.normalize([f],spec,REGION,'x')
    assert out['home']['label']=='High' and out['home']['danger']==3


def test_the_poller_asks_only_for_the_fields_the_manifest_names(monkeypatch):
    seen={}
    async def fake(client,url,params):
        seen.update(url=url,fields=params['outFields']);return []
    monkeypatch.setattr(arc,'settings',REGION);monkeypatch.setattr(arc,'query_features',fake)
    monkeypatch.setattr(arc,'set_feed',AsyncMock())
    import asyncio;asyncio.run(arc.ArcgisFireDangerPoller('wadnr-fire-danger',SPEC).poll())
    assert seen['url'].endswith('/MapServer/0/query')
    assert set(seen['fields'].split(','))=={'OBJECTID','FIREDANGER_AREA_NM','DNR_REGION_NAME','FIRE_DANGER_LEVEL_NM','BURN_BAN_LEVEL_NM','BURN_BAN_LEVEL_CD','NOTES_TXT'}
