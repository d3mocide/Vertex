from types import SimpleNamespace
import pytest
from pollers import nifc_incidents as nifc

REGION=SimpleNamespace(region_lat=45.5,region_lon=-122.7,bbox_min_lat=45,bbox_max_lat=46.1,bbox_min_lon=-123.2,bbox_max_lon=-122)


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
