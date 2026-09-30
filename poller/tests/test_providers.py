"""Startup resolves explicit pack choices even when map configuration is env-pinned."""
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import providers


@pytest.mark.asyncio
@pytest.mark.parametrize('choice,expected', [
    ({'packs': ['oregon', 'washington']}, {'odot-tripcheck', 'oregon-odin', 'odf-fire-danger', 'wsdot-travel', 'wadnr-fire-danger'}),
    ({'packs': []}, set()),
    ({'packs': ['washington']}, {'wsdot-travel', 'wadnr-fire-danger'}),
    (None, {'odot-tripcheck', 'oregon-odin', 'odf-fire-danger'}),
])
async def test_startup_selection_with_env_pinned_center(monkeypatch, choice, expected):
    root = Path(os.environ.get('REGION_PACKS_DIR', '/regions'))
    if not root.is_dir():
        root = Path(__file__).resolve().parents[2] / 'regions'
    monkeypatch.setenv('REGION_PACKS_DIR', str(root))
    monkeypatch.setattr(providers, 'env_locked', lambda settings: True)
    read = AsyncMock()
    monkeypatch.setattr(providers, '_read_stored', read)
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value={'value': choice} if choice is not None else None))
    settings = SimpleNamespace(odot_api_key='fixture-key', wsdot_api_key='fixture-key', bbox_min_lat=45,
        bbox_max_lat=46.1, bbox_min_lon=-123.2, bbox_max_lon=-122)
    plan, errors, selected = await providers.resolve_startup(pool, settings)
    assert set(plan) == expected and errors == {} and selected == choice
    assert all(p['reason'] is None for p in plan.values())
    read.assert_not_awaited()


def test_factory_skips_disabled_and_empty_contract_providers():
    plan = {'wsdot-travel': {'reason': None, 'contracts': ['traffic.cameras']},
            'odot-tripcheck': {'reason': 'not_configured', 'contracts': ['traffic.cameras']},
            'oregon-odin': {'reason': None, 'contracts': []}}
    assert [p.name for p in providers.build_pollers(plan)] == ['wsdot']
