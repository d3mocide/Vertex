"""Load the common registry from the installed region support directory."""
import os
import sys
from pathlib import Path

root = Path(os.environ.get("REGION_SHARED_DIR", "/regions/_shared"))
if not root.is_dir():
    root = Path(__file__).resolve().parents[1] / "regions" / "_shared"
sys.path.insert(0, str(root))
from catalog import (CONTRACT_IDS, LEGACY_PROVIDERS, PROVIDERS, SELECTION_KEY,
                     combined_feeds, intersects, provider_plan, selected_ids, selection_signature)
