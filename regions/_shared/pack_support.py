"""Region packs: discover, validate and match the packs installed under ``regions/``.

A pack is a directory with a ``pack.yml`` manifest (see regions/_template and
docs/architecture/region-packs.md). This module is deliberately free of app dependencies so the same
checks can run from tests, CI or the command line:

    python3 backend/packs.py regions
"""
from __future__ import annotations

import os
import ipaddress
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

import yaml

SCHEMA = 1
SUPPORTED_KINDS = {"builtin"}   # declarative kinds (gtfs_rt, arcgis_featureserver, ...) arrive later
NEWS_FORMATS = {"rss"}
ALERT_FORMATS = {"rss", "flashalert_xml"}
MAX_FEEDS = 25
_ID = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
_KEY = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
_STATE = re.compile(r"^[A-Z]{2}$")
# Things that must never be published in a pack: LAN addresses, personal paths, e-mail addresses.
_PRIVATE = re.compile(r"(?:\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+|/home/|/Users/|[\w.+-]+@[\w-]+\.\w+)")


class PackError(ValueError):
    pass


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _strings(v)
    elif isinstance(node, (list, tuple)):
        for v in node:
            yield from _strings(v)


def _num(v) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise PackError("covers.bbox must be four numbers")
    return float(v)


def _feeds(raw, kind: str, formats: set[str]) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_FEEDS:
        raise PackError(f"feeds.{kind} must be a list of at most {MAX_FEEDS} feeds")
    out, seen = [], set()
    for f in raw:
        if not isinstance(f, dict):
            raise PackError(f"each feeds.{kind} entry needs a name and url")
        name, url = f.get("name"), f.get("url")
        if not isinstance(name, str) or not (1 <= len(name) <= 128):
            raise PackError(f"feeds.{kind}: each feed needs a name (1-128 characters)")
        if not isinstance(url, str) or not re.match(r"^https?://[^\s]+$", url) or len(url) > 512:
            raise PackError(f"feeds.{kind}: {name!r} needs an http(s) url")
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            port = parsed.port
            if not host or parsed.username is not None or parsed.password is not None:
                raise ValueError()
            if host.lower().rstrip('.').endswith(('.local', '.localhost')) or host.lower().rstrip('.') == 'localhost':
                raise ValueError()
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                address = None
            if address is not None and not address.is_global:
                raise ValueError()
            if port is not None and not 1 <= port <= 65535:
                raise ValueError()
        except ValueError:
            raise PackError(f"feeds.{kind}: URLs must have a public host and no embedded credentials") from None
        fmt = f.get("format", "rss")
        if not isinstance(fmt, str) or fmt not in formats:
            raise PackError(f"feeds.{kind}: {name!r} format must be one of {', '.join(sorted(formats))}")
        if url in seen:
            raise PackError(f"feeds.{kind}: duplicate url for {name!r}")
        seen.add(url)
        out.append({"name": name, "url": url, "format": fmt})
    return out


def validate(manifest: dict, dirname: str, known_contracts: set[str]) -> dict:
    """Check a parsed manifest and return the normalized pack. Raises PackError with a readable reason."""
    if not isinstance(manifest, dict):
        raise PackError("pack.yml must be a mapping")
    if manifest.get("schema") != SCHEMA:
        raise PackError(f"schema must be {SCHEMA}")
    pid = manifest.get("id")
    if not isinstance(pid, str) or not _ID.match(pid):
        raise PackError("id must be lowercase letters, digits and dashes (2-32 characters)")
    if pid != dirname:
        raise PackError(f"id {pid!r} must match the directory name {dirname!r}")
    name = manifest.get("name")
    if not isinstance(name, str) or not (1 <= len(name) <= 64):
        raise PackError("name is required (1-64 characters)")

    covers = manifest.get("covers") or {}
    states = covers.get("states") or []
    if not isinstance(states, list) or not all(isinstance(s, str) and _STATE.match(s) for s in states):
        raise PackError("covers.states must be two-letter state codes")
    bbox = covers.get("bbox")
    if bbox is not None:
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise PackError("covers.bbox must be [min_lon, min_lat, max_lon, max_lat]")
        min_lon, min_lat, max_lon, max_lat = (_num(v) for v in bbox)
        if not (min_lon < max_lon and min_lat < max_lat and -180 <= min_lon and max_lon <= 180 and -90 <= min_lat and max_lat <= 90):
            raise PackError("covers.bbox has impossible bounds")
        bbox = [min_lon, min_lat, max_lon, max_lat]
    if not states and bbox is None:
        raise PackError("covers needs states, a bbox, or both")

    keys, seen_keys = [], set()
    for k in manifest.get("requires_keys") or []:
        kname = k.get("name") if isinstance(k, dict) else None
        if not isinstance(kname, str) or not _KEY.match(kname):
            raise PackError("each requires_keys entry needs an environment variable name like MY_API_KEY")
        if kname in seen_keys:
            raise PackError(f"duplicate key {kname}")
        seen_keys.add(kname)
        unlocks = k.get("unlocks") or []
        bad = [c for c in unlocks if c not in known_contracts]
        if bad:
            raise PackError(f"key {kname} unlocks unknown contract(s): {', '.join(bad)}")
        keys.append({"name": kname, "where": str(k.get("where") or ""), "free": bool(k.get("free", False)),
                     "unlocks": list(unlocks)})

    providers, seen_ids, provides = [], set(), []
    for p in manifest.get("providers") or []:
        prid = p.get("id") if isinstance(p, dict) else None
        if not isinstance(prid, str) or not _ID.match(prid):
            raise PackError("each provider needs an id")
        if prid in seen_ids:
            raise PackError(f"duplicate provider {prid}")
        seen_ids.add(prid)
        kind = p.get("kind")
        if kind not in SUPPORTED_KINDS:
            raise PackError(f"provider {prid}: kind {kind!r} is not supported yet (supported: {', '.join(sorted(SUPPORTED_KINDS))})")
        prov = p.get("provides") or []
        if not prov:
            raise PackError(f"provider {prid} must provide at least one contract")
        bad = [c for c in prov if c not in known_contracts]
        if bad:
            raise PackError(f"provider {prid} provides unknown contract(s): {', '.join(bad)}")
        providers.append({"id": prid, "kind": kind, "provides": list(prov)})
        provides.extend(c for c in prov if c not in provides)
    if not providers:
        raise PackError("a pack needs at least one provider")

    feeds_raw = manifest.get("feeds", {})
    if feeds_raw is None:
        feeds_raw = {}
    if not isinstance(feeds_raw, dict):
        raise PackError("feeds must be a mapping with news and/or alerts lists")
    if set(feeds_raw) - {"news", "alerts"}:
        raise PackError("feeds supports only news and alerts lists")
    feeds = {"news": _feeds(feeds_raw.get("news"), "news", NEWS_FORMATS),
             "alerts": _feeds(feeds_raw.get("alerts"), "alerts", ALERT_FORMATS)}

    for text in _strings(manifest):
        if _PRIVATE.search(text):
            raise PackError("packs must not contain private addresses, personal paths or e-mail addresses")

    return {
        "id": pid, "name": name, "description": str(manifest.get("description") or ""),
        "maintainers": [str(m) for m in (manifest.get("maintainers") or [])],
        "covers": {"states": states, "bbox": bbox},
        "requires_keys": keys, "providers": providers, "provides": provides, "feeds": feeds,
        "defaults": manifest.get("defaults") or {},
    }


def discover(packs_dir: str | os.PathLike, known_contracts: set[str]) -> list[dict]:
    """Every pack under packs_dir. Invalid packs are returned with valid=False and a reason so the
    operator can see why; they are never selectable and never crash the app."""
    root = Path(packs_dir)
    out: list[dict] = []
    if not root.is_dir():
        return out
    for d in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith(("_", "."))):
        manifest_path = d / "pack.yml"
        try:
            if not manifest_path.is_file():
                raise PackError("missing pack.yml")
            manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
            pack = validate(manifest, d.name, known_contracts)
            out.append({**pack, "valid": True, "error": None})
        except (PackError, yaml.YAMLError) as exc:
            out.append({"id": d.name, "name": d.name, "valid": False, "error": str(exc).splitlines()[0]})
    return out


def covers_point(pack: dict, lat: float, lon: float, state: str | None = None) -> bool:
    """Whether a valid pack covers a location (by bounding box, or by US state when known)."""
    c = pack.get("covers") or {}
    bbox = c.get("bbox")
    if bbox and bbox[1] <= lat <= bbox[3] and bbox[0] <= lon <= bbox[2]:
        return True
    return bool(state and state.upper() in (c.get("states") or []))


def key_status(pack: dict, environ) -> list[dict]:
    """Which keys the pack needs and whether each is present in the environment. Never returns values."""
    return [{**k, "present": bool(environ.get(k["name"]))} for k in pack.get("requires_keys", [])]
