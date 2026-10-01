"""Fixed imports for reviewed agency configurations; manifests never supply module names."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from oregon.adapters.transit import SOURCES as OREGON
from washington.adapters.transit import SOURCES as WASHINGTON

SOURCES = {**OREGON, **WASHINGTON}
