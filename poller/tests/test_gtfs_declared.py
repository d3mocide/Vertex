"""Transit agencies declared in a region pack run on the same engine as the built-in ones."""
import os
from pathlib import Path

import pytest

import providers
import provider_catalog
from pack_support import discover
from pollers import gtfs_rt


def _installed():
    root = Path(os.environ.get('REGION_PACKS_DIR', '/regions'))
    if not root.is_dir():
        root = Path(__file__).resolve().parents[2] / 'regions'
    return {p['id']: p for p in discover(root, provider_catalog.CONTRACT_IDS) if p['valid']}


def _declared(pid):
    for pack in _installed().values():
        provider_catalog.register_declared(pack)
    return gtfs_rt.declared_source(pid, provider_catalog.PROVIDERS[pid]['declarative'])


def test_cherriots_declared_in_the_oregon_pack_matches_its_old_built_in_entry():
    source = _declared('cherriots-transit')
    # What regions/oregon/adapters/transit.py said before the move.
    assert (source['name'], source['label']) == ('cherriots', 'Cherriots')
    assert source['static_url'] == 'https://cherriots.rideralerts.com/InfoPoint/gtfs-zip.ashx' and source['realtime_url'] == ''
    assert provider_catalog.PROVIDERS['cherriots-transit']['bbox'] == (-123.6, 44.65, -122.3, 45.4)
    assert set(provider_catalog.PROVIDERS['cherriots-transit']['contracts']) == {'transit.routes'}
    assert gtfs_rt.GtfsRtPoller('cherriots-transit', source).interval == 3600


def test_sound_transit_declared_in_the_washington_pack_matches_its_old_built_in_entry(monkeypatch):
    source = _declared('soundtransit-transit')
    assert (source['name'], source['label'], source['key_env'], source['key_param']) == ('soundtransit', 'Sound Transit', 'SOUNDTRANSIT_API_KEY', 'key')
    assert source['static_url'] == 'https://www.soundtransit.org/GTFS-rail/40_gtfs.zip'
    assert source['realtime_url'] == 'https://api.pugetsound.onebusaway.org/api/gtfs_realtime/vehicle-positions-for-agency/40.pb'
    assert provider_catalog.PROVIDERS['soundtransit-transit']['bbox'] == (-123.2, 46.8, -121.3, 48.3)
    poller = gtfs_rt.GtfsRtPoller('soundtransit-transit', source)
    assert poller.name == 'gtfs_soundtransit' and poller.interval == 30
    assert poller.modes == {0, 1, 2, 3, *range(100, 200), *range(400, 500), *range(700, 800), 800}     # same default as before
    monkeypatch.setenv('SOUNDTRANSIT_API_KEY', 'fixture-key')
    assert gtfs_rt.source_key(source) == 'fixture-key'
    monkeypatch.delenv('SOUNDTRANSIT_API_KEY')
    assert gtfs_rt.source_key(source) == ''


def test_declared_route_types_and_poll_interval_apply():
    spec = {'attribution': 'Metro Transit', 'static_url': 'https://t.example.org/g.zip', 'realtime_url': 'https://t.example.org/v.pb',
            'key': None, 'route_types': [0, 1, 2], 'poll_seconds': 45, 'coverage': None}
    poller = gtfs_rt.GtfsRtPoller('metro-transit', gtfs_rt.declared_source('metro-transit', spec))
    assert poller.modes == {0, 1, 2} and poller.interval == 45 and poller.name == 'gtfs_metro'
    assert gtfs_rt.source_key({'key': 'trimet_app_id'}) == gtfs_rt.settings.trimet_app_id        # built-ins still use Settings


def test_build_pollers_makes_a_gtfs_poller_for_each_declared_agency(monkeypatch):
    for pack in _installed().values():
        provider_catalog.register_declared(pack)
    plan = {'cherriots-transit': {'reason': None, 'contracts': ['transit.routes']},
            'soundtransit-transit': {'reason': None, 'contracts': ['transit.routes', 'transit.vehicles']},
            'ctran-transit': {'reason': 'access_unverified', 'contracts': ['transit.routes']}}
    assert sorted(p.name for p in providers.build_pollers(plan)) == ['gtfs_cherriots', 'gtfs_soundtransit']


@pytest.mark.asyncio
async def test_a_deselected_agency_leaves_no_entities_or_route_shapes_behind(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    store = {'transit:entities:cherriots': {b'gtfs:cherriots:1'}, 'transit:entities:oldagency': {b'gtfs:oldagency:7'}}

    async def scan(match):
        for key in ['transit:entities:cherriots', 'transit:entities:oldagency'] if 'entities' in match else \
                ['cache:transit:cherriots:paths', 'cache:transit:oldagency:paths']:
            yield key.encode()

    redis = MagicMock(scan_iter=scan, smembers=AsyncMock(side_effect=lambda k: store[k]), delete=AsyncMock(), publish=AsyncMock(),
                      hdel=AsyncMock(), hset=AsyncMock(), set=AsyncMock())
    monkeypatch.setattr(providers, 'resolve_startup', AsyncMock(return_value=({'cherriots-transit': {'reason': None, 'contracts': ['transit.routes']}}, {}, None)))
    monkeypatch.setattr('provider_feeds.configure', lambda plan: None)
    monkeypatch.setattr('provider_feeds.reconcile', AsyncMock())
    for pack in _installed().values():
        provider_catalog.register_declared(pack)
    await providers.start_providers(None, None, redis)
    deleted = {c.args[0] for c in redis.delete.await_args_list}
    assert 'transit:entities:oldagency' in deleted and 'cache:transit:oldagency:paths' in deleted and 'entity:gtfs:oldagency:7' in deleted
    assert 'transit:entities:cherriots' not in deleted and 'cache:transit:cherriots:paths' not in deleted     # the active agency is untouched
