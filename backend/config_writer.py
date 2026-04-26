"""
YAML write-back for sources.yml.

All mutations go through this module so that UI-created sources are
persisted to the mounted config file and survive database wipes.

Note: yaml.safe_dump does not preserve comments. Comments in sources.yml
are stripped on the first write-back. The sources.example.yml file remains
as the human-readable reference.
"""

import asyncio
import os
import pathlib

import yaml

CONFIG_PATH = pathlib.Path(os.environ.get("SOURCES_CONFIG_PATH", "/config/sources.yml"))

_write_lock = asyncio.Lock()


def _read_raw() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return yaml.safe_load(CONFIG_PATH.read_text()) or {}


def _write_raw(data: dict) -> None:
    CONFIG_PATH.write_text(yaml.safe_dump(data, default_flow_style=False, sort_keys=False))


async def add_entry(section: str, entry: dict) -> None:
    """Append an entry dict to a list section in sources.yml."""
    async with _write_lock:
        data = _read_raw()
        data.setdefault(section, [])
        # Normalise: strip None-valued list in case of `section: []` parsed as None
        if data[section] is None:
            data[section] = []
        data[section].append(entry)
        _write_raw(data)


async def remove_entry(section: str, url: str) -> None:
    """Remove the entry matching url from a list section."""
    async with _write_lock:
        data = _read_raw()
        entries = data.get(section) or []
        data[section] = [e for e in entries if e.get("url") != url]
        _write_raw(data)


async def update_entry(section: str, url: str, updates: dict) -> None:
    """Apply field updates to the entry matching url in a list section."""
    async with _write_lock:
        data = _read_raw()
        entries = data.get(section) or []
        for entry in entries:
            if entry.get("url") == url:
                entry.update(updates)
                break
        data[section] = entries
        _write_raw(data)


async def add_alert_zone(zone_code: str) -> None:
    """Append a zone code to alert_zones.nws_zones."""
    async with _write_lock:
        data = _read_raw()
        az = data.setdefault("alert_zones", {"nws_zones": [], "source": "config"})
        zones = az.get("nws_zones") or []
        if zone_code not in zones:
            zones.append(zone_code)
        az["nws_zones"] = zones
        _write_raw(data)


async def remove_alert_zone(zone_code: str) -> None:
    """Remove a zone code from alert_zones.nws_zones."""
    async with _write_lock:
        data = _read_raw()
        az = data.get("alert_zones") or {}
        az["nws_zones"] = [z for z in (az.get("nws_zones") or []) if z != zone_code]
        data["alert_zones"] = az
        _write_raw(data)
