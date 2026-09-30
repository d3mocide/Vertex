"""Compatibility entry point for the shared region-pack validator."""
import sys
import provider_catalog  # adds the reviewed shared-module directory to the import path
from pack_support import (SCHEMA, SUPPORTED_KINDS, NEWS_FORMATS, ALERT_FORMATS, MAX_FEEDS,
                          PackError, validate, discover, covers_point, key_status)

if __name__ == "__main__":  # python3 backend/packs.py regions
    from capabilities import CONTRACTS
    packs = discover(sys.argv[1] if len(sys.argv) > 1 else "regions", {c.id for c in CONTRACTS})
    for p in packs:
        print(("ok      " if p["valid"] else "INVALID ") + p["id"] + ("" if p["valid"] else f": {p['error']}"))
    sys.exit(0 if packs and all(p["valid"] for p in packs) else 1)
