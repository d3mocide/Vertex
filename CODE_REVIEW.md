# Vertex Code Review Tracker

**Started:** 2026-05-08  
**Reviewer:** Claude (claude-sonnet-4-6)  
**Goal:** Security, correctness, and code quality across all containers

---

## Review Order

| # | Scope | Status | Session |
|---|-------|--------|---------|
| 1 | `poller/` — external ingestion, normalizers, geofence | ✅ Complete | 2026-05-08 |
| 2 | `backend/` — API surface, auth, WebSocket | ✅ Complete | 2026-05-08 |
| 3 | `frontend/` — TypeScript, Zustand, XSS vectors | ⬜ Not Started | — |
| 4 | `db/` — init SQL, schema, indexes | ⬜ Not Started | — |
| 5 | Cross-cutting — API contracts, Redis channels, env/config | ⬜ Not Started | — |

---

## 1. Poller (`poller/`)

**Files reviewed:**
- [x] `main.py`
- [x] `config.py` / `config_loader.py` ✦ / `config_watcher.py` / `config_sync.py` ✦
- [x] `db.py`
- [x] `geofence.py`
- [x] `bus.py` ✦
- [x] `sanitize.py` ✦
- [x] `pollers/base.py`
- [x] `pollers/adsb.py`
- [x] `pollers/ais.py`
- [x] `pollers/alerts.py`
- [x] `pollers/anomaly.py`
- [x] `pollers/aprs.py`
- [x] `pollers/beast_transport.py` ✦
- [x] `pollers/cot_emitter.py` / `cot_receiver.py`
- [x] `pollers/fire.py`
- [x] `pollers/lightning.py`
- [x] `pollers/meshcore.py`
- [x] `pollers/news.py`
- [x] `pollers/p25.py`
- [x] `pollers/seismic.py`
- [x] `pollers/streamgauge.py` ✦
- [x] `pollers/summary.py`
- [x] `pollers/tinygs.py`
- [x] `pollers/traffic.py`
- [x] `pollers/utilities.py`
- [x] `pollers/weather.py`
- [x] `normalizers/aircraft.py` ✦
- [x] `normalizers/bds_decoders.py`
- [x] `normalizers/beast_decoder.py`
- [x] `normalizers/beast_math.py` ✦
- [x] `normalizers/mesh_node.py` ✦
- [x] `normalizers/vessel.py` ✦
- [x] `normalizers/weather.py` ✦
- [x] `enrichment/adsbdb.py`
- [x] `enrichment/aircraft_db.py` ✦
- [x] `enrichment/airlines_db.py` ✦
- [x] `enrichment/airports_db.py` ✦
- [x] `enrichment/cache.py`
- [x] `enrichment/metar.py`
- [x] `enrichment/navaids_db.py`
- [x] `enrichment/route_plausibility.py` ✦

✦ = no findings

**Findings:**

<!-- Format: [SEVERITY] file:line — description -->
<!-- SEVERITY: CRIT / HIGH / MED / LOW / NIT -->

**[CRIT] `db.py:122` — SQL injection via Redis-controlled `retention_days`**
`purge_observations()` reads `retention_days` from a Redis key then formats it directly into an f-string SQL interval: `f"DELETE FROM observations WHERE ts < NOW() - INTERVAL '{retention_days} days'"`. A Redis compromise or misconfigured admin API could inject an arbitrary SQL interval string.
_Fix: Use a parameterised query — `$1 * INTERVAL '1 day'` — so the value is never string-formatted into SQL._

**[HIGH] `pollers/cot_emitter.py:77` — XML injection in CoT output sent to ATAK/WinTAK clients**
`_build_cot()` formats `callsign`, `uid`, `remarks`, `cot_type`, `lat`, `lon`, `alt_m` into an XML f-string. All values originate from untrusted external sources (BEAST, AIS, TAK clients). A callsign containing `<`, `>`, or `"` produces malformed CoT XML delivered to every connected ATAK client. Same issue in `_build_annotation_cot()`.
_Fix: Escape all values with `xml.sax.saxutils.escape()` / `quoteattr()`, or build the document with `xml.etree.ElementTree`._

**[HIGH] `pollers/cot_receiver.py:49-51` — zero-coordinate fallback silently places entities at 0°N 0°E**
`_parse_cot()` defaults `lat`/`lon` to `"0"` when `<point>` attributes are missing. Entities with invalid positions land at the Gulf of Guinea, pass through DB writes and geofence checks, and silently pollute the entity table.
_Fix: Reject events where `lat == 0.0 and lon == 0.0`, or validate full coordinate range after parsing._

**[HIGH] `pollers/summary.py:87-118` — indirect prompt injection via untrusted Redis feed data**
Weather alerts, fire incidents, traffic data, and news headlines are read from Redis and interpolated directly into the LLM prompt. A compromised RSS feed or crafted NWS description could inject instructions that alter the model's output, potentially producing disinformation displayed as authoritative situational awareness.
_Fix: Truncate each field to a safe maximum length and strip known prompt-injection patterns (`###`, `SYSTEM:`, `<|`, etc.) before composing the prompt._

**[HIGH] `pollers/ais.py:69` — AISstream API key present in logged WebSocket subscription message**
The subscription dict containing `"APIKey": settings.aisstream_api_key` could appear in error tracebacks on connection failure (line 83). Some WebSocket libraries include full message content in exception strings.
_Fix: Log connection errors without including the subscription dict; confirm the key does not appear in the exception before propagating._

**[HIGH] `pollers/weather.py:62` — AirNow request URL logged at INFO level**
The `logger.info("[weather] AirNow request: %s …", url, …)` call on line 62 logs the request URL. The key is passed in `params` (not the URL string itself), so this specific line is safe — but it is unnecessary noise and establishes a risky pattern.
_Fix: Remove the `logger.info(…url…)` call._

**[MED] `pollers/anomaly.py:67` — wrong column names mean anomaly events are silently never persisted**
`_insert_anomaly_event()` inserts into columns `(event_type, entity_type, severity, description, ts)`. The actual schema uses `(event_type, entity_id, ts, severity, summary, details)`. The `PostgresError` is caught silently; the Redis publish still fires, so the frontend shows the event but it never appears in event history.
_Fix: Use `db.write_event()` with the canonical signature._

**[MED] `pollers/alerts.py:99-109` — references non-existent `Settings` attributes, crashes on fresh deploy**
`setup()` references `settings.flashalert_enabled`, `settings.flashalert_url`, `settings.tvfr_enabled`, `settings.tvfr_rss_url` — none of which exist in `config.py`. This crashes the first `setup()` call on any deployment where `alert_feed_configs` is empty.
_Fix: Add these fields to `Settings` with empty-string defaults, or remove the fallback block._

**[MED] `pollers/traffic.py:286-313` — SSRF via unvalidated camera URLs from ODOT API**
`_check_camera_health()` issues HTTP HEAD requests to every URL in the `cctv-url` field returned by the ODOT API with no validation. A MITM'd or compromised ODOT endpoint could return internal addresses (`169.254.169.254`, `localhost:5432`) and probe internal services.
_Fix: Validate that each URL resolves to a public address; reject RFC-1918, loopback, and link-local targets._

**[MED] `geofence.py:13` — `_entity_state` dict grows indefinitely**
Module-level `_entity_state` accumulates an entry per entity and is never pruned. On a busy ADS-B receiver this can reach tens of thousands of entries over days of uptime.
_Fix: Evict entries where `entered_at` exceeds a configurable TTL (e.g. 6 hours) on the existing `exited_ids` cleanup pass._

**[MED] `pollers/adsb.py:89` — `r.keys("entity:*")` is a blocking O(N) Redis scan**
`_hydrate_from_redis()` calls `await r.keys("entity:*")` at startup, scanning the entire keyspace and blocking Redis for potentially hundreds of milliseconds on a loaded instance.
_Fix: Replace with a cursor-based `SCAN MATCH entity:*` loop, or maintain a Redis set `entity_ids` and use `SMEMBERS`._

**[MED] `pollers/cot_receiver.py:192-204` — TCP receive buffer grows without bound**
`buf += chunk` inside the reader loop has no size cap. A high-rate or malformed TAK stream can exhaust memory on the Pi before the `</event>` delimiter is found.
_Fix: Add a guard: `if len(buf) > 1_000_000: break` to trigger reconnect._

**[MED] `pollers/aprs.py:116-168` — no timeout on `reader.readline()`**
`reader.readline()` has no timeout. If the APRS server stalls without closing the connection, the task hangs forever and the reconnect loop never runs.
_Fix: Wrap in `asyncio.wait_for(reader.readline(), timeout=120)` and treat `TimeoutError` as a connection loss._

**[MED] `enrichment/cache.py:116-123` — race condition in `CachedLookup._fetch_and_cache`**
The `finally: self._inflight.pop(key, None)` runs per-awaiter. A third coroutine arriving after the first `finally` fires but before the second `await task` returns will find no inflight entry and launch a duplicate fetch.
_Fix: Use an `asyncio.Event` per key rather than task presence in `_inflight` to coalesce concurrent requests._

**[MED] `pollers/lightning.py:128` — unvalidated `int()` on untrusted Blitzortung timestamp**
`int(ns_time)` on a non-numeric value raises `ValueError` caught by the outer `except Exception`, silently dropping the strike. A very large integer would overflow JavaScript's `Number.MAX_SAFE_INTEGER` when serialised to JSON.
_Fix: Validate before conversion: `if isinstance(ns_time, (int, float)) and 0 < ns_time < 2e18`._

**[MED] `pollers/tinygs.py:78` — `float()` on untrusted `lastPacketTime` with no per-item error handling**
`float(last_ts)` is outside any try/except inside the per-station loop. A `null` or string value causes `ValueError` and silently skips all subsequent stations in the list.
_Fix: Wrap the `float()` conversion in a per-station try/except, or pre-validate with `isinstance(last_ts, (int, float))`._

**[LOW] `pollers/traffic.py:21` — `_station_map` is a class variable, not an instance variable**
All instances share the same dict. Safe now with one instance, but would cause cross-instance data bleed in tests or if instantiated multiple times.
_Fix: Move to `self._station_map = {}` in `__init__` or `setup()`._

**[LOW] `pollers/utilities.py:19` — `_consecutive_failures` initialised in `setup()`, not `__init__`**
Calling `poll()` before `setup()` (e.g. in tests) raises `AttributeError` on line 87.
_Fix: Initialise in `__init__`._

**[LOW] `pollers/weather.py:107-111` — `locals()` used in `finally` block to detect success**
`if "data" in locals()` is fragile and not reliable across all Python implementations for variables from a `try` scope.
_Fix: Use an explicit `_success = False` flag, set to `True` after successful JSON parsing._

**[LOW] `pollers/cot_receiver.py` — infinite reconnect loop with no cap on consecutive failures**
Auth rejections from the TAK server cause perpetual WARNING logs every 60 seconds with no alerting escalation.
_Fix: Log at ERROR after N consecutive failures, or add a configurable max-retry count._

**[LOW] `pollers/base.py:47` — `hasattr(self, 'close')` is always `True`**
`BasePoller.close()` is always defined on the base class; the guard is misleading.
_Fix: Remove the `hasattr` check and call `await self.close()` unconditionally._

**[LOW] `pollers/p25.py:77-93` — call-end event records new talkgroup tag instead of ending talkgroup tag**
When a talkgroup transition is detected, `tag=tag` on the call-end event reflects the *incoming* talkgroup, not the one that just ended.
_Fix: Cache `self._last_tag` alongside `self._last_tgid` and use it in the call-end record._

**[LOW] `pollers/seismic.py:19` — `_seen_ids` set grows without bound**
Accumulates USGS event IDs for the process lifetime with no expiry.
_Fix: Expire entries older than 2 hours, or bound the set size._

**[LOW] `pollers/fire.py:84` — incorrect polygon centroid when some coordinates are filtered out**
`sum(p[0] for p in ring if …) / len(ring)` divides the filtered sum by the unfiltered count, producing a wrong average when any point fails the `isinstance` check.
_Fix: Build a `valid_ring` list first and divide by `len(valid_ring)`._

**[LOW] `enrichment/adsbdb.py:93-95` — shared `_dirty_count` across route and aircraft caches**
Both caches share one dirty counter, so the flush threshold of 20 is reached after a mixed 20 lookups total rather than 20 per cache.
_Fix: Use separate counters, or accept the current (more frequent) flush behaviour._

**[LOW] `normalizers/beast_decoder.py:~420` — TAT formula is physically wrong**
`tat = sat + (0.2 * float(ac.mach) ** 2) * (sat + 273.15) - 273.15` produces ~−300°C at cruise. The correct formula is `TAT_K = (SAT + 273.15) * (1 + 0.2 * M²); TAT = TAT_K - 273.15`.
_Fix: Apply the correct formula._

**[LOW] `pollers/weather.py:54` — AirNow API URL uses HTTP, not HTTPS**
The API key is transmitted in cleartext query parameters on the first hop.
_Fix: Change to `https://www.airnowapi.org/…`._

**[LOW] `config_watcher.py:23` — mtime-based change detection has a TOCTOU window**
File may be replaced between `stat()` and `read_text()` during an atomic rename.
_Fix: Accept for this use case, or hash file content instead of relying on mtime._

**[NIT] `db.py:24-30` — DDL migrations in application startup are not idempotent tooling**
`ALTER TABLE IF NOT EXISTS` guards make re-runs safe, but schema state tied to restarts is not production-grade.
_Fix: Consider Alembic or a `db/migrations/` directory for future migrations._

**[NIT] `pollers/news.py:67-74` — generator expression unnecessarily wrapped in `list()`**
`list({...} for s in _STATIC_SOURCES)` should be a list comprehension: `[{...} for s in _STATIC_SOURCES]`.

**[NIT] `pollers/traffic.py:193` — `RADIUS_DEG` defined but never used**
Dead variable; the actual filtering uses a bounding box.
_Fix: Remove it._

**[NIT] Haversine duplicated 5× across the codebase**
`_haversine_km()` / `haversine_km` is independently implemented in `seismic.py`, `fire.py`, `adsb.py`, `enrichment/navaids_db.py`, and `normalizers/beast_math.py`. `beast_math` is the canonical one.
_Fix: Delete the four copies and import from `normalizers.beast_math`._

**[NIT] `pollers/traffic.py:176-179` — Euclidean distance approximation inconsistent with rest of codebase**
`_distance_km()` uses flat-Earth (`dy * 111, dx * 78`) while everything else uses haversine.
_Fix: Import and use `haversine_km` from `normalizers.beast_math`._

---

## 2. Backend (`backend/`)

**Files reviewed:**
- [x] `main.py`
- [x] `config.py` / `config_loader.py` ✦ / `config_writer.py`
- [x] `auth_middleware.py`
- [x] `deps.py` ✦
- [x] `rate_limit.py`
- [x] `redis_bus.py`
- [x] `webhook_dispatcher.py`
- [x] `metrics_collector.py`
- [x] `db/models.py` ✦
- [x] `db/session.py`
- [x] `schemas/entity.py` ✦ / `event.py` ✦ / `observation.py` ✦
- [x] `routers/auth.py`
- [x] `routers/admin.py`
- [x] `routers/ws.py`
- [x] `routers/entities.py`
- [x] `routers/observations.py`
- [x] `routers/events.py` ✦
- [x] `routers/geofences.py`
- [x] `routers/alerts.py`
- [x] `routers/alertrules.py`
- [x] `routers/aircraft.py` ✦
- [x] `routers/annotations.py`
- [x] `routers/entity_tags.py`
- [x] `routers/health.py` ✦
- [x] `routers/layers.py`
- [x] `routers/news.py`
- [x] `routers/radio.py` ✦
- [x] `routers/sitrep.py`
- [x] `routers/sources.py`
- [x] `routers/summary.py`
- [x] `routers/traffic.py`
- [x] `routers/utilities.py`
- [x] `routers/weather.py`
- [x] `tests/test_geofences_crud.py`

✦ = no findings

**Findings:**

---
#### Security

**[CRIT] `config.py:17` — Empty `auth_secret_key` default allows trivially-forged JWTs**
`auth_secret_key` defaults to `""`. If an operator sets `AUTH_ENABLED=true` but omits the secret, `python-jose` happily signs and verifies tokens with an empty HMAC key — any attacker who knows the algorithm can forge admin tokens.
_Fix: Raise `ValueError` at startup when `auth_enabled=True` and `auth_secret_key` is missing or shorter than 32 characters._

**[CRIT] `auth_middleware.py:49` — Missing `role` claim silently promotes any token to admin**
`role = payload.get("role", "admin")` — a token issued before the role claim was added, or any token intentionally crafted without a `role` field, is treated as admin. The identical pattern repeats in `routers/auth.py:80` and `routers/auth.py:146`.
_Fix: Default to `"viewer"` (least-privilege), or explicitly reject tokens missing `role`._

**[CRIT] `main.py:42-47` — CORS wildcard (`allow_origins=["*"]`)**
All origins accepted for all methods and headers. Unnecessarily broad for a Pi dashboard and incompatible with any future `allow_credentials=True` addition.
_Fix: Restrict `allow_origins` to the dashboard's actual LAN origin(s)._

**[HIGH] `main.py:49` — Prometheus `/metrics` endpoint is publicly unauthenticated**
`Instrumentator().expose(app)` mounts `/metrics` which is exempted from both `AuthMiddleware` and `RateLimitMiddleware`. It leaks request rates, latency histograms, and path labels — useful reconnaissance for an attacker.
_Fix: Remove `/metrics` from `_PUBLIC_PATHS` and guard it, or serve it on an internal-only port not exposed by Nginx._

**[HIGH] `routers/admin.py:36-88` — Admin endpoints fully public when `auth_enabled=False` (the default)**
All `/admin/*` routes rely solely on `AuthMiddleware`, which is a no-op when auth is disabled. This exposes DB table sizes, query rates, poller heartbeats, and the ability to change data retention to anyone on the network.
_Fix: Always require an admin JWT for admin routes, or enforce via Nginx that `/api/v1/admin/*` is only reachable from localhost._

**[HIGH] `webhook_dispatcher.py:90-113` — SSRF via user-controlled webhook URL**
`_dispatch_webhook` reads `url = cfg.get("url")` from `rule.action_config` stored in the DB and issues an HTTP POST to it with zero URL validation. A stored rule pointing to `http://169.254.169.254/` or `http://localhost:5432/` probes internal services.
_Fix: Validate the URL scheme and reject RFC-1918, loopback, and link-local destinations before dispatching._

**[HIGH] `routers/alertrules.py:62-64` — Webhook URL accepted without scheme/host validation**
`create_alert_rule` only checks that the URL is truthy; `file:///etc/passwd` or `http://internal/` are accepted. Same on update.
_Fix: Add a `HttpUrl` Pydantic validator on `action_config.url`, or validate scheme and reject non-HTTP(S) at the schema layer._

**[HIGH] `routers/auth.py:72-82` — `_decode_admin` re-implements JWT decode, bypassing `AuthMiddleware`**
User-management routes (`GET/PATCH/DELETE /auth/users`) use an inline `_decode_admin()` helper with `except Exception: pass` rather than the shared middleware path. A change to the secret or algorithm must be applied in three places independently.
_Fix: Centralise JWT validation into a single `decode_token()` in a `security.py` module; use a `Depends(get_current_admin_user)` dependency everywhere._

---
#### Reliability

**[HIGH] `main.py:28-36` — Shutdown catches `BaseException` and silences everything**
`except BaseException: pass` during task cleanup hides real shutdown errors that aren't `CancelledError`.
_Fix: Only catch `asyncio.CancelledError`; log all other exceptions._

**[HIGH] `redis_bus.py:37-43` — `r.keys("entity:*")` O(N) blocking scan on every entity list request**
Called on every `/entities` fetch and WebSocket snapshot. Blocks the Redis server while scanning, causing latency spikes as entity count grows.
_Fix: Replace with `SCAN` iteration (`r.scan_iter`) or maintain a Redis Set `entities:index` and use `SMEMBERS` + pipeline._

**[HIGH] `webhook_dispatcher.py:116-152` — `run_webhook_dispatcher` dies permanently on any Redis disconnect**
A single uncaught exception from `pubsub.listen()` causes the function to return. The background task created in `main.py` is never restarted, silently ending all webhook evaluation for the process lifetime.
_Fix: Wrap the body in an outer `while True` loop with exponential backoff reconnection._

**[HIGH] `metrics_collector.py:89-99` — `run_metrics_collector` silently swallows all exceptions**
`except Exception: pass` discards every error including Redis disconnections. The admin metrics panel shows stale data with no log output.
_Fix: At minimum log: `except Exception as exc: logger.warning("[metrics] %s", exc)`._

---
#### Correctness

**[MED] `auth_middleware.py:21` — All `/api/v1/auth/*` paths bypass middleware, including user-management routes**
`path.startswith("/api/v1/auth/")` skips auth for the entire prefix. `GET /auth/users`, `PATCH /auth/users/{id}`, and `DELETE /auth/users/{id}` rely solely on the router's inline `_decode_admin` guard with no middleware backstop.
_Fix: Only exempt specific login/setup paths, not the entire prefix._

**[MED] `rate_limit.py:30` — Rate limit key uses `client.host`, which is always `127.0.0.1` behind Nginx**
All clients appear as the proxy IP, so the rate limiter either never fires or fires for all clients simultaneously.
_Fix: Read real IP from `X-Forwarded-For` / `X-Real-IP`, or configure Uvicorn with `--forwarded-allow-ips`._

**[MED] `routers/observations.py:43` — `end` parameter not normalised to UTC**
`start` gets explicit UTC normalisation; `end` does not. A timezone-naive `end` value causes a PostgreSQL type mismatch error at runtime.
_Fix: Apply the same `replace(tzinfo=timezone.utc)` guard to `end`._

**[MED] `routers/auth.py:100-101` — TOCTOU race in `/auth/setup`**
`_user_count(db)` check then insert are not atomic. Two concurrent setup requests both pass the zero-count check and both insert, potentially creating two admin accounts.
_Fix: Wrap check-and-insert in a serialisable transaction or rely on the DB unique constraint and catch `IntegrityError`._

**[MED] `webhook_dispatcher.py:135` — DB session opened per Redis event with no error handling**
An unavailable DB raises an unhandled exception that exits the `async for` loop and kills the dispatcher permanently.
_Fix: Wrap per-event DB access in `try/except Exception` that logs and continues._

**[MED] `webhook_dispatcher.py:76-86` — Redis rate-limit `INCR` + `EXPIRE` is non-atomic**
A crash between the two commands leaves the key without a TTL, persisting indefinitely.
_Fix: Use a Lua script or pipeline to atomically `INCR` and conditionally `EXPIRE`._

**[MED] `routers/admin.py:84-88` — `POST /admin/retention` writes Redis but never prunes the DB**
`config:retention_days` is stored but nothing reads it to perform actual `DELETE` pruning. Operators believe they are controlling retention but no data is ever purged.
_Fix: Implement an actual purge task, or document clearly that the setting is informational only._

**[MED] `routers/ws.py:9-60` — WebSocket handler cannot identify the authenticated user**
`AuthMiddleware` validates the token from `?token=` but never attaches the decoded payload to `request.state`. The route handler has no access to user identity for per-user filtering or audit.
_Fix: Attach decoded payload to `request.state.user` in `AuthMiddleware` for all request types._

**[MED] `redis_bus.py:59-63` — New pubsub connection created per WebSocket client**
`r.pubsub()` is called on the shared Redis singleton for every connecting WebSocket client, creating many concurrent subscriptions and risking file-descriptor exhaustion under load.
_Fix: Use a single shared fan-out: subscribe once and broadcast in-process to all connected WebSocket clients._

**[MED] `config_writer.py:23-30` — Synchronous file I/O on the async event loop**
`CONFIG_PATH.read_text()` and `CONFIG_PATH.write_text()` block the event loop. On a Pi with an SD card, writes can stall all async tasks for tens of milliseconds.
_Fix: Use `asyncio.to_thread()` to offload the blocking calls._

**[MED] `routers/news.py:11`, `routers/traffic.py:11,17` — Unguarded `json.loads` raises HTTP 500 on malformed Redis data**
`json.loads(raw)` without try/except; contrast with `weather.py` which correctly wraps the call.
_Fix: Add `try/except (json.JSONDecodeError, TypeError): return []` as done in `weather.py`._

**[MED] `webhook_dispatcher.py:97` — User-controlled `timeout_s` is unbounded**
A rule stored with `timeout_s: 99999` holds an asyncio task and DB connection open for days, starving other webhook deliveries.
_Fix: Clamp: `timeout = min(float(cfg.get("timeout_s") or 10), 30.0)`._

**[MED] `routers/sitrep.py:86-91` — Unescaped Redis/DB content rendered into Markdown report**
`ai_summary`, event `summary`, and entity type names from the DB are interpolated directly into the Markdown download. Attacker-controlled content (compromised RSS → Redis) can inject arbitrary Markdown including external image links that leak the operator's IP.
_Fix: Strip/truncate all DB- and Redis-sourced strings before embedding in the report._

**[MED] `routers/layers.py:55` — Unbounded GeoJSON accepted and stored to DB**
`LayerCreate.geojson: dict` has no size limit, schema validation, or feature count cap. A multi-gigabyte payload can exhaust PostgreSQL storage.
_Fix: Add a Pydantic validator enforcing valid GeoJSON structure and a maximum coordinate/feature count._

**[MED] `routers/sources.py:208-213` — TOCTOU race on zone code uniqueness check**
Check-then-insert with no serialisation; two concurrent requests with the same code both pass the check.
_Fix: Handle `IntegrityError` from the DB unique constraint instead of pre-checking._

---
#### Code Quality

**[MED] `redis_bus.py:35-36` — Loop variable `r` shadows the Redis client `r`**
`for r in results:` inside `get_all_entities` overwrites the `r = get_redis()` variable. Any code added after the loop would silently use the last pipeline result instead of the Redis client.
_Fix: Rename loop variable to `raw` or `result_item`._

**[MED] `routers/auth.py:63` — `_make_token` defaults `role="admin"`**
Calling `_make_token(username)` without specifying a role silently grants admin. A future call site that omits the role argument would create an unintended admin token.
_Fix: Remove the default; require `role` to be passed explicitly._

**[LOW] `db/session.py:35` — `IntegrityError` match on internal PostgreSQL index name**
`"pg_class_relname_nsp_index" not in str(exc)` is fragile across PostgreSQL minor versions and non-English locales.
_Fix: Match on the specific constraint name from the DDL or use `asyncpg.exceptions.UniqueViolationError`._

**[LOW] `routers/admin.py:36` — GET admin routes readable by any valid viewer token**
`AuthMiddleware` only enforces admin role for mutating methods. Viewer-role users can read the full admin metrics panel.
_Fix: Add an explicit admin-role dependency check to the GET admin routes._

**[LOW] `routers/entities.py:15` — `entity_id` path param not validated before Redis key construction**
Raw path segment (potentially containing newlines or wildcards) is passed directly to Redis key construction.
_Fix: Add `Path(max_length=64, pattern=r"^[a-zA-Z0-9_:.-]+$")` to `entity_id`._

**[LOW] `routers/geofences.py:17-28` — `GeofencePayload.name` has no length limit**
An unbounded name string is accepted and stored. Same for `description`.
_Fix: `Field(min_length=1, max_length=128)` on `name`; length cap on `description`._

**[LOW] `routers/sources.py:208-225` — `zone_code` has no format validation**
Accepts any string; stored and passed to NWS API queries without format enforcement.
_Fix: `Field(max_length=32, pattern=r"^[A-Z]{2}[ZC]\d{3}$")`._

**[LOW] `routers/annotations.py:92-93` — `created_by` is always `None` when auth is disabled**
Audit trail is empty in the default no-auth configuration.
_Fix: Set `created_by = "local"` when `auth_enabled=False`._

**[LOW] `tests/test_geofences_crud.py:32-35` — Mock settings use wrong attribute names**
`_mock_settings.secret_key` and `_mock_settings.enable_auth` don't exist on `Settings`; the correct names are `auth_secret_key` and `auth_enabled`. Tests that check `settings.auth_enabled` get a truthy `MagicMock()` instead of `False`.
_Fix: Use correct attribute names._

**[NIT] `redis_bus.py:59-63` — Channel name mismatch: WS subscribes to `civic:updates`, annotations publish to `annotation_update`**
Annotation events are never received by WebSocket clients. Either intentional or a bug.
_Fix: Clarify intent with a comment, or add `annotation_update` to the WS subscription._

**[NIT] Multiple GET routers — no `response_model` annotations**
`weather.py`, `alerts.py`, `utilities.py`, `summary.py` return inconsistent shapes on Redis miss (`[]` vs `{}` vs domain object) with no Pydantic contract visible to clients.
_Fix: Add `response_model=` to each route decorator._

---

## 3. Frontend (`frontend/src/`)

**Files reviewed:**
- [ ] `main.tsx` / `App.tsx` / `AdminApp.tsx`
- [ ] `store.ts` / `storeTypes.ts`
- [ ] `config.ts`
- [ ] `auth.ts`
- [ ] `hooks/useWebSocket.ts`
- [ ] `hooks/useEntities.ts` / `useAlerts.ts` / `useRadioStreams.ts`
- [ ] `hooks/useSystemHealth.ts` / `useTrailHydration.ts`
- [ ] `components/LoginPage.tsx`
- [ ] `components/Map.tsx` / `MapOverlay.tsx`
- [ ] `components/layout/*` (6 files)
- [ ] `components/panels/*` (16 files)
- [ ] `components/layers/*` (10 files)
- [ ] `layers/build*.ts` (12 files)
- [ ] `layers/colorUtils.ts` / `geoUtils.ts` / `iconAtlas.ts` / `pvb.ts`
- [ ] `admin/*` (3 files + metrics/)
- [ ] `entityUtils.ts` / `incidentUtils.ts`
- [ ] `notifications.ts` / `snapshotExport.ts`
- [ ] `tsconfig.json` / `vite.config.ts` / `nginx.conf`

**Findings:**

_None logged yet._

---

## 4. Database (`db/`)

**Files reviewed:**
- [ ] `db/init/01_schema.sql`
- [ ] `db/init/02_geofences.sql`
- [ ] `db/init/03_sources.sql`
- [ ] `db/init/04_entity_mission_tags.sql`
- [ ] `db/init/05_annotations.sql`

**Findings:**

_None logged yet._

---

## 5. Cross-Cutting

**Areas to check:**
- [ ] Backend API routes vs. frontend `config.ts` endpoint paths
- [ ] Redis channel names: `redis_bus.py` vs. `poller/bus.py`
- [ ] Pydantic schemas vs. frontend TypeScript types
- [ ] `.env.example` completeness vs. all config.py fields
- [ ] Docker Compose health checks and dependency ordering
- [ ] `docker-compose.yml` vs. `docker-compose.dev.yml` drift

**Findings:**

_None logged yet._

---

## Severity Legend

| Label | Meaning |
|-------|---------|
| **CRIT** | Security vulnerability or data-loss risk — fix before merge |
| **HIGH** | Bug that will cause incorrect behavior in production |
| **MED** | Reliability or correctness issue under non-happy-path conditions |
| **LOW** | Design smell, missing validation, or risky pattern |
| **NIT** | Style, naming, or minor improvement |

---

## Summary (updated each session)

| Session | Date | Findings added | Files reviewed |
|---------|------|---------------|----------------|
| 1 | 2026-05-08 | 1 CRIT, 5 HIGH, 10 MED, 12 LOW, 7 NIT | 43 (all of `poller/`) |
| 2 | 2026-05-08 | 3 CRIT, 8 HIGH, 16 MED, 7 LOW, 2 NIT | 38 (all of `backend/`) |

### Session 2 Highlights
The backend is well-structured with correct parameterised queries and async session handling throughout. The most serious cluster is the **auth system**: empty secret-key default allows trivially-forged JWTs, any token missing the `role` claim silently becomes admin, JWT decode logic is duplicated in three independent places, and the entire `/api/v1/auth/` prefix bypasses `AuthMiddleware` including user-management routes. The **webhook/alertrule subsystem** is a second critical cluster: SSRF via stored URLs with zero host validation, non-atomic Redis rate-limiting, and the dispatcher dying permanently on any Redis disconnect. The unauthenticated Prometheus `/metrics` and fully-public admin endpoints (when auth is off, the default) round out the high-priority items. 11 of 38 files were completely clean.

### Session 1 Highlights
The poller is well-structured overall — consistent parameterised DB queries throughout, working `sanitize_payload()` at every ingestion boundary, and reasonable error handling in most pollers. The most urgent issues are: a SQL injection in `purge_observations()` (Redis-controlled integer string-formatted into an SQL interval), XML injection in the CoT emitter that affects every connected ATAK/WinTAK client, an indirect prompt injection vector in the AI summary poller, and a database schema mismatch in the anomaly poller that silently discards all anomaly event history. Several reliability gaps: `geofence._entity_state` and `seismic._seen_ids` are unbounded in memory; CoT receiver buffer is unbounded; APRS TCP read has no timeout. The TAT formula in `beast_decoder.py` produces physically impossible values (~−300°C). Haversine is duplicated five times and should be consolidated into `normalizers.beast_math`.
