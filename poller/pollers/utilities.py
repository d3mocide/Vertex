"""Compatibility import for the reviewed Oregon utilities adapter."""
import sys

from regional_adapters import utilities as _adapter

sys.modules[__name__] = _adapter
