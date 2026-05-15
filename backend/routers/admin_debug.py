import asyncio
import json
import time
from collections import Counter
from typing import Literal, Optional
from urllib.parse import urlparse, urlunparse

import httpx
import websockets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db
from security import validate_safe_host, validate_safe_url

router = APIRouter(prefix="/admin/debug", tags=["admin"])


class MeshProbeRequest(BaseModel):
    source_url: Optional[str] = None
    duration_seconds: int = Field(default=20, ge=5, le=60)


class RemoteFeedProbeRequest(BaseModel):
    source_type: Literal["adsb", "ais", "p25", "meshcore", "fire", "aprs"]
    source_url: Optional[str] = None
    duration_seconds: int = Field(default=20, ge=5, le=60)


def _parse_source(url: str) -> dict:
    """Extract embedded credentials from URL and return clean base_url + auth tuple."""
    parsed = urlparse(url)
    auth = None
    if parsed.username:
        auth = (parsed.username, parsed.password or "")
        netloc = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
        url = urlunparse(parsed._replace(netloc=netloc))
    return {"base_url": url.rstrip("/"), "auth": auth}


def _to_ws_url(http_url: str) -> str:
    if http_url.startswith("https://"):
        return "wss://" + http_url[8:]
    return "ws://" + http_url.removeprefix("http://")


def _auth_headers(auth: tuple | None) -> dict[str, str]:
    if not auth:
        return {}
    import base64

    token = base64.b64encode(f"{auth[0]}:{auth[1]}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def _sanitize_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.username:
        netloc = parsed.hostname + (f":{parsed.port}" if parsed.port else "")
        return urlunparse(parsed._replace(netloc=netloc))
    return url


async def _resolve_source(db: AsyncSession, source_type: str, source_url: Optional[str]) -> dict:
    if source_url:
        row = await db.execute(
            text(
                "SELECT id, type, name, url, enabled, source FROM poller_sources "
                "WHERE type = :source_type AND url = :url LIMIT 1"
            ),
            {"source_type": source_type, "url": source_url},
        )
        source = row.mappings().first()
        if source:
            return dict(source)
        return {
            "id": None,
            "type": source_type,
            "name": source_url,
            "url": source_url,
            "enabled": True,
            "source": "ad_hoc",
        }

    row = await db.execute(
        text(
            "SELECT id, type, name, url, enabled, source FROM poller_sources "
            "WHERE type = :source_type AND enabled = TRUE "
            "ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1"
        ),
        {"source_type": source_type},
    )
    source = row.mappings().first()
    if not source:
        raise HTTPException(status_code=404, detail=f"No enabled {source_type} source configured")
    return dict(source)


async def _http_get_check(url: str, auth: Optional[httpx.BasicAuth] = None, timeout: float = 10.0) -> tuple[dict, object | None]:
    t0 = time.perf_counter()
    try:
        validate_safe_url(url, allowed_schemes=("http", "https"))
        async with httpx.AsyncClient(auth=auth, timeout=timeout) as client:
            resp = await client.get(url)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        payload = None
        summary = ""
        try:
            payload = resp.json()
        except Exception:
            payload = None

        if isinstance(payload, list):
            summary = f"{len(payload)} item(s)"
        elif isinstance(payload, dict):
            summary = f"{len(payload.keys())} key(s)"

        return {
            "ok": resp.status_code == 200,
            "status_code": resp.status_code,
            "latency_ms": latency_ms,
            "summary": summary,
        }, payload
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": latency_ms,
            "summary": "",
            "error": str(exc),
        }, None


async def _http_post_check(url: str, body: object, auth: Optional[httpx.BasicAuth] = None, timeout: float = 10.0) -> tuple[dict, object | None]:
    t0 = time.perf_counter()
    try:
        validate_safe_url(url, allowed_schemes=("http", "https"))
        async with httpx.AsyncClient(auth=auth, timeout=timeout) as client:
            resp = await client.post(url, json=body)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        payload = None
        summary = ""
        try:
            payload = resp.json()
        except Exception:
            payload = None

        if isinstance(payload, list):
            summary = f"{len(payload)} item(s)"
        elif isinstance(payload, dict):
            summary = f"{len(payload.keys())} key(s)"

        return {
            "ok": resp.status_code == 200,
            "status_code": resp.status_code,
            "latency_ms": latency_ms,
            "summary": summary,
        }, payload
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": latency_ms,
            "summary": "",
            "error": str(exc),
        }, None


async def _probe_ws(ws_url: str, duration_seconds: int, headers: Optional[dict[str, str]] = None) -> dict:
    event_counts: Counter = Counter()
    event_samples: list[str] = []
    ws_error: Optional[str] = None
    ws_connected = False

    try:
        validate_safe_url(ws_url, allowed_schemes=("ws", "wss"))
        async with websockets.connect(
            ws_url,
            extra_headers=headers or {},
            ping_interval=20,
            ping_timeout=20,
            open_timeout=10,
            close_timeout=5,
        ) as ws:
            ws_connected = True
            start = time.monotonic()
            while (time.monotonic() - start) < duration_seconds:
                timeout = min(1.0, duration_seconds - (time.monotonic() - start))
                if timeout <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                except asyncio.TimeoutError:
                    continue

                event_type = "non_json"
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        event_type = str(parsed.get("type") or "unknown")
                    elif isinstance(parsed, list):
                        event_type = "json_list"
                except Exception:
                    pass

                event_counts[event_type] += 1
                if event_type not in event_samples and len(event_samples) < 12:
                    event_samples.append(event_type)
    except Exception as exc:
        ws_error = str(exc)

    return {
        "connected": ws_connected,
        "event_counts": dict(event_counts),
        "event_samples": event_samples,
        "error": ws_error,
    }


def _parse_aprs_source(url: str) -> tuple[str, int]:
    parsed = urlparse(url)
    if parsed.hostname:
        return parsed.hostname, parsed.port or 14580
    if ":" in url:
        host, port_s = url.rsplit(":", 1)
        try:
            return host.strip(), int(port_s)
        except Exception:
            pass
    return url.strip(), 14580


async def _probe_aprs_tcp(url: str) -> dict:
    host, port = _parse_aprs_source(url)
    t0 = time.perf_counter()
    reader = None
    writer = None
    try:
        validate_safe_host(host)
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=8)
        # Standard receive-only APRS-IS login for diagnostics.
        writer.write(b"user N0CALL pass -1 vers VertexDebug 1.0\n")
        await writer.drain()
        line = await asyncio.wait_for(reader.readline(), timeout=5)
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        banner = line.decode("utf-8", errors="ignore").strip() if line else ""
        return {
            "ok": True,
            "status_code": None,
            "latency_ms": latency_ms,
            "summary": banner[:180] if banner else "Connected; no banner line received",
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        return {
            "ok": False,
            "status_code": None,
            "latency_ms": latency_ms,
            "summary": "",
            "error": str(exc),
        }
    finally:
        if writer:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


@router.get("/remote-feeds")
async def list_remote_feeds(db: AsyncSession = Depends(get_db)):
    """List currently configured remote-feed sources for on-demand diagnostics."""
    rows = await db.execute(
        text(
            "SELECT id, type, name, url, enabled, source "
            "FROM poller_sources "
            "WHERE enabled = TRUE "
            "ORDER BY type, name"
        )
    )
    items = [dict(r) for r in rows.mappings().all()]

    for item in items:
        item["url"] = _sanitize_url(str(item.get("url") or ""))

    return {
        "all_sources": items,
    }


@router.post("/remote-feeds/probe")
async def probe_remote_feed(body: RemoteFeedProbeRequest, db: AsyncSession = Depends(get_db)):
    source = await _resolve_source(db, body.source_type, body.source_url)
    source_url = str(source.get("url") or "")

    try:
        validate_safe_url(source_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or unsafe source URL: {exc}")

    src = _parse_source(source_url)
    base_url = src["base_url"]
    auth = src.get("auth")
    headers = _auth_headers(auth)
    httpx_auth = httpx.BasicAuth(*auth) if auth else None

    checks: list[dict] = []
    ws: Optional[dict] = None
    storage: Optional[dict] = None
    recommendations: list[str] = []

    if body.source_type == "meshcore":
        for name, path in (("health", "/api/health"), ("contacts", "/api/contacts"), ("neighbors", "/api/neighbors")):
            check, payload = await _http_get_check(f"{base_url}{path}", auth=httpx_auth)
            if isinstance(payload, list):
                check["summary"] = f"{len(payload)} item(s)"
            elif isinstance(payload, dict):
                if path == "/api/health":
                    connected = payload.get("radio_connected", payload.get("connected", payload.get("radio_ok")))
                    check["summary"] = f"radio_connected={connected}"
                elif "items" in payload and isinstance(payload.get("items"), list):
                    check["summary"] = f"{len(payload.get('items', []))} item(s)"
                elif "contacts" in payload and isinstance(payload.get("contacts"), list):
                    check["summary"] = f"{len(payload.get('contacts', []))} contact(s)"
                elif "neighbors" in payload and isinstance(payload.get("neighbors"), list):
                    check["summary"] = f"{len(payload.get('neighbors', []))} neighbor(s)"

            checks.append({"name": name, "protocol": "http", **check})

        ws = await _probe_ws(_to_ws_url(base_url) + "/api/ws", body.duration_seconds, headers=headers)

        stats_row = await db.execute(
            text(
                "SELECT COUNT(*) AS total_count, "
                "COUNT(*) FILTER (WHERE ts > now() - interval '1 hour') AS last_hour_count, "
                "MAX(ts) AS latest_ts "
                "FROM mesh_messages WHERE source_url = :source_url"
            ),
            {"source_url": base_url},
        )
        stats = dict(stats_row.mappings().first() or {})
        storage = {
            "total_messages": int(stats.get("total_count") or 0),
            "last_hour_messages": int(stats.get("last_hour_count") or 0),
            "latest_timestamp": stats.get("latest_ts").isoformat() if stats.get("latest_ts") else None,
        }

        neighbors = next((c for c in checks if c.get("name") == "neighbors"), None)
        if not ws.get("connected"):
            recommendations.append("WebSocket connection failed; verify RemoteTerm reachability and auth.")
        if ws.get("connected") and ws.get("event_counts", {}).get("message", 0) == 0:
            recommendations.append("No message events observed; RemoteTerm may be emitting only telemetry (health/contact/raw_packet).")
        if neighbors and neighbors.get("status_code") == 404:
            recommendations.append("/api/neighbors returned 404; topology enrichment via neighbor endpoint is unavailable.")
        if storage["total_messages"] == 0:
            recommendations.append("No persisted mesh messages found for this source yet.")

    elif body.source_type == "adsb":
        check, payload = await _http_get_check(base_url, auth=httpx_auth)
        if isinstance(payload, dict) and isinstance(payload.get("aircraft"), list):
            check["summary"] = f"aircraft={len(payload.get('aircraft', []))}"
        checks.append({"name": "aircraft_json", "protocol": "http", **check})
        if check.get("ok") and not (isinstance(payload, dict) and isinstance(payload.get("aircraft"), list)):
            recommendations.append("Response is 200 but does not look like tar1090 aircraft.json (missing 'aircraft' list).")

    elif body.source_type == "ais":
        ws = await _probe_ws(base_url, body.duration_seconds)
        checks.append({
            "name": "ais_stream",
            "protocol": "ws",
            "ok": ws.get("connected", False),
            "status_code": None,
            "latency_ms": 0.0,
            "summary": f"events={sum(ws.get('event_counts', {}).values())}",
            "error": ws.get("error"),
        })
        if ws.get("connected") and sum(ws.get("event_counts", {}).values()) == 0:
            recommendations.append("AIS websocket connected but no messages observed in probe window.")

    elif body.source_type == "p25":
        check, payload = await _http_post_check(
            base_url,
            [{"command": "update", "arg1": 0, "arg2": 0}],
            auth=httpx_auth,
        )
        if isinstance(payload, list):
            check["summary"] = f"records={len(payload)}"
        elif isinstance(payload, dict):
            tgid = payload.get("curr_tgid") or payload.get("tgid")
            check["summary"] = f"tgid={tgid}" if tgid else "state payload"
        checks.append({"name": "terminal_update", "protocol": "http_post", **check})
        if check.get("ok") and payload is None:
            recommendations.append("P25 endpoint reachable but returned non-JSON response.")

    elif body.source_type == "fire":
        check, payload = await _http_get_check(base_url, auth=httpx_auth)
        if isinstance(payload, dict) and isinstance(payload.get("events"), list):
            check["summary"] = f"events={len(payload.get('events', []))}"
        checks.append({"name": "events_feed", "protocol": "http", **check})
        if check.get("ok") and not (isinstance(payload, dict) and isinstance(payload.get("events"), list)):
            recommendations.append("Fire feed responded but does not include an 'events' list.")

    elif body.source_type == "aprs":
        check = await _probe_aprs_tcp(source_url)
        checks.append({"name": "tcp_login", "protocol": "tcp", **check})
        if check.get("ok") and "Connected; no banner" in str(check.get("summary")):
            recommendations.append("APRS TCP connected but no banner line returned within timeout.")

    return {
        "source": {
            "id": source.get("id"),
            "type": body.source_type,
            "name": source.get("name"),
            "base_url": base_url,
            "display_url": _sanitize_url(source_url),
            "duration_seconds": body.duration_seconds,
        },
        "checks": checks,
        "ws": ws,
        "storage": storage,
        "recommendations": recommendations,
    }


@router.post("/meshcore/probe")
async def probe_meshcore_feed(body: MeshProbeRequest, db: AsyncSession = Depends(get_db)):
    """Backward-compatible MeshCore probe endpoint (delegates to generic remote feed probe)."""
    return await probe_remote_feed(
        RemoteFeedProbeRequest(
            source_type="meshcore",
            source_url=body.source_url,
            duration_seconds=body.duration_seconds,
        ),
        db,
    )
