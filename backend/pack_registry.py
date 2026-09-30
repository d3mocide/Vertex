"""Where region packs are installed and which are usable."""
from __future__ import annotations

import os

import packs
from capabilities import CONTRACTS


def packs_dir() -> str:
    return os.environ.get("REGION_PACKS_DIR", "/regions")


def installed() -> list[dict]:
    """Every pack found (valid or not). Manifests are tiny, so they are read on demand."""
    return packs.discover(packs_dir(), {c.id for c in CONTRACTS})


def valid_by_id() -> dict[str, dict]:
    return {p["id"]: p for p in installed() if p.get("valid")}
