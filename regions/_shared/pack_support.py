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
DECLARATIVE_KINDS = {"arcgis_featureserver", "gtfs_rt", "wzdx"}   # described entirely by the manifest; json_rest follows
SUPPORTED_KINDS = {"builtin"} | DECLARATIVE_KINDS
ARCGIS_CONTRACTS = {"fire.danger"}
WZDX_CONTRACTS = {"traffic.incidents"}
GTFS_CONTRACTS = {"transit.routes", "transit.vehicles"}
# Environment variables a manifest may name as its API key. A pack must not be able to read (and so send to an agency's
# server) arbitrary secrets such as DATABASE_URL, so the name is either in the PACK_ namespace or one of these existing,
# reviewed credentials.
GTFS_LEGACY_KEYS = {"TRIMET_APP_ID", "SOUNDTRANSIT_API_KEY"}
_PACK_KEY = re.compile(r"^PACK_[A-Z0-9_]{2,56}$")
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


def _check_public_url(url: str, where: str, https_only: bool = False) -> None:
    """URLs in a pack must point at a public host, with no credentials, so a pack cannot aim Vertex at a private network."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port
        if not host or parsed.username is not None or parsed.password is not None:
            raise ValueError()
        if https_only and parsed.scheme != "https":
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
        raise PackError(f"{where}: URLs must have a public {'https ' if https_only else ''}host and no embedded credentials") from None


def _bbox(raw, what: str):
    """[min_lon, min_lat, max_lon, max_lat] as floats, or None when absent."""
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) != 4:
        raise PackError(f"{what} must be [min_lon, min_lat, max_lon, max_lat]")
    min_lon, min_lat, max_lon, max_lat = (_num(v) for v in raw)
    if not (min_lon < max_lon and min_lat < max_lat and -180 <= min_lon and max_lon <= 180 and -90 <= min_lat and max_lat <= 90):
        raise PackError(f"{what} has impossible bounds")
    return [min_lon, min_lat, max_lon, max_lat]


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
        _check_public_url(url, f"feeds.{kind}")
        fmt = f.get("format", "rss")
        if not isinstance(fmt, str) or fmt not in formats:
            raise PackError(f"feeds.{kind}: {name!r} format must be one of {', '.join(sorted(formats))}")
        if url in seen:
            raise PackError(f"feeds.{kind}: duplicate url for {name!r}")
        seen.add(url)
        out.append({"name": name, "url": url, "format": fmt})
    return out


_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
_OUT = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_RESERVED_OUT = {"zone", "danger", "danger_rank", "label", "dist_km", "provider_id", "attribution", "scope", "type"}


def _field(name, where: str) -> str:
    if not isinstance(name, str) or not _FIELD.match(name):
        raise PackError(f"{where} must be a field name from the service (letters, digits, underscore)")
    return name


def _arcgis_fire_danger(p: dict, prid: str, covers_bbox) -> dict:
    """Validated settings of an ``arcgis_featureserver`` provider for the ``fire.danger`` contract."""
    where = f"provider {prid}"
    if covers_bbox is None:
        raise PackError(f"{where}: a declarative provider needs covers.bbox (it is the provider's coverage)")
    url = p.get("url")
    if not isinstance(url, str) or len(url) > 512 or not re.match(r"^https://[^\s?#]+$", url):
        raise PackError(f"{where}: url must be the https address of a FeatureServer or MapServer layer (no query string)")
    _check_public_url(url, where, https_only=True)
    url = url.rstrip("/")
    if url.endswith("/query") or not re.search(r"/(?:FeatureServer|MapServer)/\d+$", url):
        raise PackError(f"{where}: url must end in /FeatureServer/<layer> or /MapServer/<layer>, without /query")
    attribution = p.get("attribution")
    if not isinstance(attribution, str) or not (1 <= len(attribution) <= 40):
        raise PackError(f"{where}: attribution is required (the agency's name, up to 40 characters)")
    refresh = p.get("refresh_minutes", 30)
    if isinstance(refresh, bool) or not isinstance(refresh, int) or not 5 <= refresh <= 1440:
        raise PackError(f"{where}: refresh_minutes must be a whole number from 5 to 1440")

    fields = p.get("fields")
    if not isinstance(fields, dict) or set(fields) - {"id", "zone", "level"} or "zone" not in fields or "level" not in fields:
        raise PackError(f"{where}: fields needs zone and level (and may name an id field)")
    zone = fields["zone"]
    zone = [_field(z, f"{where}: fields.zone") for z in zone] if isinstance(zone, list) and zone and len(zone) <= 4 \
        else [_field(zone, f"{where}: fields.zone")]
    out_fields = {"zone": zone, "level": _field(fields["level"], f"{where}: fields.level"),
                  "id": _field(fields["id"], f"{where}: fields.id") if fields.get("id") is not None else None}

    levels_raw = p.get("levels")
    if not isinstance(levels_raw, dict) or not (1 <= len(levels_raw) <= 12):
        raise PackError(f"{where}: levels maps the agency's danger wording (or codes) to a danger from 1 to 4")
    levels = {}
    for raw_key, row in levels_raw.items():
        if not isinstance(row, dict) or set(row) - {"danger", "rank", "label"}:
            raise PackError(f"{where}: each level needs danger (1-4) and may add rank (1-5) and label")
        danger, rank, label = row.get("danger"), row.get("rank", row.get("danger")), row.get("label")
        for what, value, hi in (("danger", danger, 4), ("rank", rank, 5)):
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= hi:
                raise PackError(f"{where}: level {raw_key!r} {what} must be a whole number from 1 to {hi}")
        if label is not None and (not isinstance(label, str) or not 1 <= len(label) <= 40):
            raise PackError(f"{where}: level {raw_key!r} label must be 1-40 characters")
        key = str(raw_key).strip().casefold()
        if key in levels:
            raise PackError(f"{where}: level {raw_key!r} is listed twice")
        levels[key] = {"danger": danger, "rank": rank, "label": label}

    extra_raw = p.get("extra") or {}
    if not isinstance(extra_raw, dict) or len(extra_raw) > 12:
        raise PackError(f"{where}: extra maps up to 12 output names to service fields")
    extra = {}
    for out, field in extra_raw.items():
        if not isinstance(out, str) or not _OUT.match(out) or out in _RESERVED_OUT:
            raise PackError(f"{where}: extra output name {out!r} is not allowed")
        extra[out] = _field(field, f"{where}: extra.{out}")
    scope = p.get("scope")
    if scope is not None and (not isinstance(scope, str) or len(scope) > 200):
        raise PackError(f"{where}: scope is a sentence of at most 200 characters")
    skip = p.get("skip_unknown", False)
    if not isinstance(skip, bool):
        raise PackError(f"{where}: skip_unknown must be true or false")
    return {"url": url, "attribution": attribution, "refresh_minutes": refresh, "fields": out_fields, "levels": levels,
            "extra": extra, "scope": scope, "skip_unknown": skip}


def _key(key, where: str, key_names: set, allowed: bool, why_not: str):
    """Validated ``key: {env, param}`` of a declarative provider, or None. The variable must be a ``PACK_*`` name (or a
    reviewed legacy name) listed under requires_keys, so a manifest can never make Vertex send its own secrets."""
    if key is None:
        return None
    if not isinstance(key, dict) or set(key) != {"env", "param"}:
        raise PackError(f"{where}: key needs env (the environment variable) and param (the query parameter the agency expects)")
    env, param = key["env"], key["param"]
    if not isinstance(env, str) or not (_PACK_KEY.match(env) or env in GTFS_LEGACY_KEYS):
        raise PackError(f"{where}: key.env must start with PACK_ (or be one of {', '.join(sorted(GTFS_LEGACY_KEYS))})")
    if env not in key_names:
        raise PackError(f"{where}: key.env {env} must also be listed under requires_keys so the setup wizard can show it")
    if not isinstance(param, str) or not re.match(r"^[A-Za-z][A-Za-z0-9_]{0,31}$", param):
        raise PackError(f"{where}: key.param must be a query parameter name")
    if not allowed:
        raise PackError(f"{where}: {why_not}")
    return {"env": env, "param": param}


def _wzdx(p: dict, prid: str, prov: list, covers_bbox, key_names: set) -> dict:
    """Validated settings of a ``wzdx`` provider: a US DOT Work Zone Data Exchange GeoJSON feed as ``traffic.incidents``."""
    where = f"provider {prid}"
    coverage = _bbox(p.get("coverage"), f"{where}: coverage")
    if coverage is None and covers_bbox is None:
        raise PackError(f"{where}: a declarative provider needs its own coverage or the pack's covers.bbox")
    if set(prov) != WZDX_CONTRACTS:
        raise PackError(f"{where}: wzdx provides only {', '.join(sorted(WZDX_CONTRACTS))}")
    url = p.get("url")
    if not isinstance(url, str) or len(url) > 512 or not re.match(r"^https://[^\s?#]+$", url):
        raise PackError(f"{where}: url must be an https address with no query string (keys go in the key setting)")
    _check_public_url(url, f"{where}: url", https_only=True)
    attribution = p.get("attribution")
    if not isinstance(attribution, str) or not (1 <= len(attribution) <= 40):
        raise PackError(f"{where}: attribution is required (the agency's name, up to 40 characters)")
    link = p.get("link")
    if link is not None:
        if not isinstance(link, str) or len(link) > 512 or not re.match(r"^https://[^\s]+$", link):
            raise PackError(f"{where}: link must be an https address of the agency's traveler-information page")
        _check_public_url(link, f"{where}: link", https_only=True)
    key = _key(p.get("key"), where, key_names, True, "")
    poll = p.get("poll_seconds", 300)
    if isinstance(poll, bool) or not isinstance(poll, int) or not 60 <= poll <= 3600:
        raise PackError(f"{where}: poll_seconds must be a whole number from 60 to 3600")
    return {"attribution": attribution, "url": url, "link": link, "key": key, "poll_seconds": poll, "coverage": coverage}


def _gtfs_rt(p: dict, prid: str, prov: list, covers_bbox, key_names: set) -> dict:
    """Validated settings of a ``gtfs_rt`` provider: a GTFS schedule, optionally with a GTFS Realtime vehicle feed."""
    where = f"provider {prid}"
    coverage = _bbox(p.get("coverage"), f"{where}: coverage")
    if coverage is None and covers_bbox is None:
        raise PackError(f"{where}: a declarative provider needs its own coverage or the pack's covers.bbox")
    if "transit.routes" not in prov or set(prov) - GTFS_CONTRACTS:
        raise PackError(f"{where}: gtfs_rt provides transit.routes and, with a realtime_url, transit.vehicles")
    urls = {}
    for name, required in (("static_url", True), ("realtime_url", False), ("alerts_url", False)):
        url = p.get(name)
        if url is None and not required:
            urls[name] = ""
            continue
        if not isinstance(url, str) or len(url) > 512 or not re.match(r"^https://[^\s?#]+$", url):
            raise PackError(f"{where}: {name} must be an https address with no query string (keys go in the key setting)")
        _check_public_url(url, f"{where}: {name}", https_only=True)
        urls[name] = url
    if "transit.vehicles" in prov and not urls["realtime_url"]:
        raise PackError(f"{where}: transit.vehicles needs a realtime_url")
    if urls["realtime_url"] and "transit.vehicles" not in prov:
        raise PackError(f"{where}: a realtime_url is only used when the provider provides transit.vehicles")
    attribution = p.get("attribution")
    if not isinstance(attribution, str) or not (1 <= len(attribution) <= 40):
        raise PackError(f"{where}: attribution is required (the agency's name, up to 40 characters)")

    key = _key(p.get("key"), where, key_names, bool(urls["realtime_url"] or urls["alerts_url"]),
               "a key is only used on the realtime and alerts feeds, which this provider does not have")

    types = p.get("route_types")
    if types is not None:
        if (not isinstance(types, list) or not 1 <= len(types) <= 40
                or any(isinstance(t, bool) or not isinstance(t, int) or not 0 <= t <= 1799 for t in types)):
            raise PackError(f"{where}: route_types is a list of GTFS route_type numbers (0 tram, 1 subway, 2 rail, 3 bus ...)")
        types = sorted(set(types))
    poll = p.get("poll_seconds", 30)
    if isinstance(poll, bool) or not isinstance(poll, int) or not 15 <= poll <= 3600:
        raise PackError(f"{where}: poll_seconds must be a whole number from 15 to 3600")
    return {"attribution": attribution, "static_url": urls["static_url"], "realtime_url": urls["realtime_url"],
            "alerts_url": urls["alerts_url"], "key": key,
            "route_types": types, "poll_seconds": poll, "coverage": coverage}


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
    bbox = _bbox(covers.get("bbox"), "covers.bbox")
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
        entry = {"id": prid, "kind": kind, "provides": list(prov)}
        if kind == "arcgis_featureserver":
            if len(prov) != 1 or prov[0] not in ARCGIS_CONTRACTS:
                raise PackError(f"provider {prid}: arcgis_featureserver can provide only {', '.join(sorted(ARCGIS_CONTRACTS))}")
            entry["spec"] = _arcgis_fire_danger(p, prid, bbox)
        elif kind == "gtfs_rt":
            entry["spec"] = _gtfs_rt(p, prid, prov, bbox, seen_keys)
        elif kind == "wzdx":
            entry["spec"] = _wzdx(p, prid, prov, bbox, seen_keys)
        providers.append(entry)
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
