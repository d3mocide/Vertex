"""AIS motion contracts use synthetic positions and a fixed reception clock."""
import pytest
from normalizers import vessel

NOW = '2026-01-01T00:01:00+00:00'

@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(vessel, '_now', lambda: NOW)
    vessel._static_cache.clear()


def stream(kind='PositionReport', **fields):
    return {'MessageType': kind, 'MetaData': {'MMSI': '000000001', 'time_utc': NOW},
            'Message': {kind: {'Latitude': 0, 'Longitude': 0, 'Sog': 12, 'Cog': 90,
                              'TrueHeading': 80, **fields}}}

@pytest.mark.parametrize('kind', ['PositionReport', 'StandardClassBPositionReport'])
def test_course_and_bow_are_separate(kind):
    e = vessel.normalize_aisstream(stream(kind))
    assert e['lat'] == e['lon'] == 0
    assert e['heading'] == 90
    assert e['identity']['true_heading'] == 80
    assert e['position_age_s'] == 0
    assert not e['position_stale']


def test_unavailable_motion_is_not_a_real_direction_or_speed():
    e = vessel.normalize_aisstream(stream(Cog=360, TrueHeading=511, Sog=102.3))
    assert e['heading'] is None and e['speed'] is None
    assert e['identity']['true_heading'] is None

@pytest.mark.parametrize('fields', [{'Latitude': 91}, {'Longitude': 181}, {'Latitude': float('nan')}, {'Valid': False}])
def test_invalid_fix_is_dropped(fields):
    assert vessel.normalize_aisstream(stream(**fields)) is None


def test_reception_age_is_preserved_and_stale_reports_are_marked():
    data = stream()
    data['MetaData']['time_utc'] = '2025-12-31 23:58:00.123456789 +0000 UTC'
    e = vessel.normalize_aisstream(data)
    assert 179 < e['position_age_s'] < 180
    assert e['position_stale']


def test_invalid_clock_does_not_refresh_old_position():
    data = stream()
    data['MetaData']['time_utc'] = 'bad-clock'
    e = vessel.normalize_aisstream(data)
    assert e['position_ts'] is None and e['position_stale']

@pytest.mark.parametrize('time', [{'rxtime': '20260101000050'}, {'rxuxtime': 1767225650}])
def test_catcher_reception_clocks_and_course(time):
    e = vessel.normalize_ais_catcher({'mmsi': '000000001', 'lat': 0, 'lon': 0,
                                     'speed': 10, 'course': 90, 'heading': 511, **time})
    assert e['heading'] == 90 and e['identity']['true_heading'] is None
    assert e['position_age_s'] == 10


def test_missing_reception_clock_uses_local_receipt():
    data = stream()
    del data['MetaData']['time_utc']
    e = vessel.normalize_aisstream(data)
    assert e['identity']['position_time_source'] == 'local_receipt'
    assert e['position_age_s'] == 0
