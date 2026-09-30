"""Extraction must retain registry selection and legacy import identity."""
import importlib

import pytest

from providers import build_pollers


@pytest.mark.parametrize('module,provider,cls', [
    ('traffic', 'odot-tripcheck', 'TrafficPoller'),
    ('utilities', 'oregon-odin', 'UtilityPoller'),
    ('odf_fire_danger', 'odf-fire-danger', 'OdfFireDangerPoller'),
])
def test_registry_uses_pack_adapter_and_legacy_import_is_same_module(module, provider, cls):
    legacy = importlib.import_module('pollers.' + module)
    adapter = importlib.import_module('oregon.adapters.' + module)
    assert legacy is adapter  # Includes old monkeypatch targets, not just exported functions.
    plan = {provider: {'reason': None, 'contracts': ['example.contract']}}
    collectors = build_pollers(plan)
    assert len(collectors) == 1
    assert type(collectors[0]) is getattr(adapter, cls)
    assert build_pollers({provider: {'reason': 'outside_coverage', 'contracts': ['example.contract']}}) == []
