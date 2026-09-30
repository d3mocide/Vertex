"""Compatibility import for the reviewed Oregon traffic adapter."""
import sys

from regional_adapters import traffic as _adapter

sys.modules[__name__] = _adapter
