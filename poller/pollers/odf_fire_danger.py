"""Compatibility import for the reviewed Oregon odf_fire_danger adapter."""
import sys

from regional_adapters import odf_fire_danger as _adapter

sys.modules[__name__] = _adapter
