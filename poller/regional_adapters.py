"""Fixed imports for reviewed, in-repository regional adapters.

The support directory is deployed alongside the bundled packs. REGION_PACKS_DIR
and manifest fields never determine executable imports.
"""
import sys

from provider_catalog import root

sys.path.insert(0, str(root.parent))
from oregon.adapters import odf_fire_danger, traffic, utilities
