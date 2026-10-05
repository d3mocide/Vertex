"""Isolated provider snapshots merged into the existing contract feed keys."""
import asyncio
import json
from urllib.parse import unquote, urlsplit

from provider_catalog import PROVIDERS
from transit_sources import SOURCES as TRANSIT_SOURCES

owners = {}
_locks = {}
_TTLS = {"traffic:incidents": 1800, "traffic:cameras": 10800, "traffic:signs": 2700,
         "traffic:flow": 1800, "traffic:corridors": 1800, "weather:rwis": 4500,
         "utility:outages": 3600, "utility:oregon": 3600, "utility:pge": 3600, "fire:danger": 16200, "transit:routes": 172800, "transit:vehicles": 180}


def configure(plan):
    owners.clear()
    for pid, provider in plan.items():
        if provider["reason"]:
            continue
        for contract in provider["contracts"]:
            for feed in PROVIDERS[pid]["contracts"][contract]:
                owners.setdefault(feed, []).append(pid)
    for ids in owners.values():
        ids.sort()


def slice_key(pid, feed):
    return f"feed:provider:{pid}:{feed}"


def meta_key(pid, feed):
    return f"provider:{pid}:{feed}"


def merge(feed, snapshots):
    if not snapshots:
        return []
    if feed == "transit:routes":
        return {"type": "FeatureCollection", "features": [f for data in snapshots for f in data.get("features", [])]}
    if feed == "utility:outages":
        if not all(isinstance(data, dict) and data.get("type") == "FeatureCollection" for data in snapshots):
            raise ValueError("Outage providers require a GeoJSON FeatureCollection")
        return {"type": "FeatureCollection", "features": [f for data in snapshots for f in data.get("features", [])],
                "near": sorted([row for data in snapshots for row in data.get("near", [])], key=lambda row: row.get("dist_km", float("inf"))),
                "utilities": [row for data in snapshots for row in data.get("utilities", [])],
                "coverage": list(dict.fromkeys(label for data in snapshots for label in data.get("coverage", []))),
                "near_radius_km": min((data.get("near_radius_km", 30) for data in snapshots), default=30),
                "updated": max((data.get("updated") or "" for data in snapshots), default=""),
                "providers": [data.get("provider_id") for data in snapshots]}
    if feed == "fire:danger":
        nearby = sorted([row for data in snapshots for row in data.get("nearby", [])], key=lambda row: row.get("dist_km", float("inf")))
        homes = [data["home"] for data in snapshots if data.get("home")]
        return {"type": "FeatureCollection", "features": [f for data in snapshots for f in data.get("features", [])],
                "home": homes[0] if homes else None, "homes": homes, "nearby": nearby[:8],
                "providers": [data.get("provider_id") for data in snapshots],
                "fetched_at": max((data.get("fetched_at", "") for data in snapshots), default="")}
    if not all(isinstance(data, list) for data in snapshots):
        if len(snapshots) == 1:
            return snapshots[0]
        raise ValueError("Multiple providers require a list contract")
    rows = [row for data in snapshots for row in data]
    if feed == "traffic:cameras":
        unique = {}
        for row in rows:
            url = urlsplit(row.get("url") or "")
            path = unquote(url.path)
            if url.hostname and url.hostname.lower().endswith("tripcheck.com"):
                path = path.casefold()
            key = (url.hostname, path, url.query) if row.get("url") else row.get("id")
            if key in unique:
                existing = unique[key]
                existing["provider_ids"] = list(dict.fromkeys(existing.get("provider_ids", [existing["provider_id"]]) + [row["provider_id"]]))
            else:
                unique[key] = dict(row)
        rows = list(unique.values())
    return sorted(rows, key=lambda row: row.get("dist_km", float("inf")))


# Camera image hosts that serve https. The page's Content Security Policy only loads https images, and these hosts
# answer plain http with a redirect to https anyway, so the cameras showed blank until the address was upgraded.
_HTTPS_HOSTS = ("tripcheck.com", "wsdot.com", "wsdot.wa.gov")


def _https(url):
    if not isinstance(url, str) or not url.startswith("http://"):
        return url
    host = (urlsplit(url).hostname or "").lower()
    if any(host == h or host.endswith("." + h) for h in _HTTPS_HOSTS):
        return "https://" + url[len("http://"):]
    return url


def provenance(data, pid, ts):
    if not isinstance(data, list):
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            attribution = "WA DNR" if pid == "wadnr-fire-danger" else "ODF" if pid == "odf-fire-danger" else "Oregon ODIN" if pid == "oregon-odin" else TRANSIT_SOURCES.get(pid, {}).get("label", pid)
            result = {**data, "provider_id": pid, "attribution": attribution, "fetched_at": ts}
            result["features"] = [{**f, "properties": {**f.get("properties", {}), "provider_id": pid, "attribution": attribution}}
                                  for f in data.get("features", [])]
            result["nearby"] = [{**row, "provider_id": pid, "attribution": attribution} for row in data.get("nearby", [])]
            result["near"] = [{**row, "provider_id": pid, "attribution": attribution} for row in data.get("near", [])]
            result["utilities"] = [{**row, "id": f"{pid}:{row['id']}", "provider_id": pid, "attribution": attribution}
                                   for row in data.get("utilities", [])]
            if data.get("home"):
                result["home"] = {**data["home"], "provider_id": pid, "attribution": attribution}
            return result
        return data
    rows = []
    for item in data:
        row = {**item, "provider_id": pid, "attribution": "WSDOT" if pid == "wsdot-travel" else "ODOT" if pid == "odot-tripcheck" else TRANSIT_SOURCES.get(pid, {}).get("label", pid),
               "fetched_at": ts}
        # Keep existing ODOT camera bookmarks valid; new adapters always namespace IDs.
        if pid != "odot-tripcheck" and row.get("id") is not None and not str(row["id"]).startswith(pid + ":"):
            row["id"] = f"{pid}:{row['id']}"
        if row.get("group"):
            row["group"] = f"{pid}:{row['group']}"
        for key in ("url", "ldi_url"):
            if key in row:
                row[key] = _https(row[key])
        rows.append(row)
    return rows


async def publish(r, feed, data, pid, ts, write_combined):
    if pid not in owners.get(feed, []):
        return
    async with _locks.setdefault(feed, asyncio.Lock()):
        payload = provenance(data, pid, ts)
        await r.set(slice_key(pid, feed), json.dumps(payload), ex=_TTLS.get(feed, 10800))
        await r.hset("feed:meta", meta_key(pid, feed), ts)
        snapshots = await r.mget([slice_key(p, feed) for p in owners[feed]])
        values = [json.loads(raw) for raw in snapshots if raw is not None]
        await write_combined(feed, merge(feed, values))


async def reconcile(r, write_combined):
    """Remove unselected provider slices and republish aggregates without their old rows."""
    all_feeds = {feed for spec in PROVIDERS.values() for feeds in spec["contracts"].values() for feed in feeds}
    for pid, spec in PROVIDERS.items():
        for feeds in spec["contracts"].values():
            for feed in feeds:
                if pid not in owners.get(feed, []):
                    await r.delete(slice_key(pid, feed))
                    await r.hdel("feed:meta", meta_key(pid, feed))
    for feed in sorted(all_feeds):
        active = owners.get(feed, [])
        # Upgrade legacy snapshots into a slice when there was a sole Oregon writer.
        legacy = next((pid for pid in active if pid in {"odot-tripcheck", "oregon-odin", "odf-fire-danger"}), None)
        if legacy:
            pid = legacy
            if not await r.exists(slice_key(pid, feed)):
                raw = await r.get(f"feed:{feed}")
                age_ts = await r.hget("feed:meta", feed)
                if raw and age_ts:
                    from datetime import datetime, timezone
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(age_ts)).total_seconds()
                    if age < _TTLS.get(feed, 10800):
                        data = json.loads(raw)
                        # Never re-adopt a previous multi-provider aggregate.
                        if (isinstance(data, dict) and not data.get("providers") and data.get("provider_id", pid) == pid) or (isinstance(data, list) and all(not row.get("provider_id") or row["provider_id"] == pid for row in data)):
                            await r.set(slice_key(pid, feed), json.dumps(provenance(data, pid, age_ts)), ex=max(1, int(_TTLS.get(feed, 10800) - age)))
                            await r.hset("feed:meta", meta_key(pid, feed), age_ts)
        values = await r.mget([slice_key(pid, feed) for pid in active]) if active else []
        snapshots = [json.loads(raw) for raw in values if raw is not None]
        if snapshots:
            timestamps = [await r.hget("feed:meta", meta_key(pid, feed)) for pid, raw in zip(active, values) if raw is not None]
            timestamps = [ts for ts in timestamps if ts]
            if timestamps:
                await r.hset("feed:meta", feed, max(timestamps))
            # Clearing removed providers must not make retained stale data look freshly fetched.
            await write_combined(feed, merge(feed, snapshots), refresh_age=False)
        else:
            await r.delete(f"feed:{feed}")
            await r.hdel("feed:meta", feed)
            await r.publish("civic:updates", json.dumps({"type": "feed_update", "key": feed, "data": [], "ts": ""}))
