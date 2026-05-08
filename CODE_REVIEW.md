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
| 3 | `frontend/` — TypeScript, Zustand, XSS vectors | ✅ Complete | 2026-05-08 |
| 4 | `db/` — init SQL, schema, indexes | ✅ Complete | 2026-05-08 |
| 5 | Cross-cutting — API contracts, Redis channels, env/config | ✅ Complete | 2026-05-08 |

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
- [x] `main.tsx` / `App.tsx` / `AdminApp.tsx`
- [x] `store.ts` / `storeTypes.ts`
- [x] `config.ts`
- [x] `auth.ts`
- [x] `hooks/useWebSocket.ts`
- [x] `hooks/useEntities.ts` / `useAlerts.ts` ✦ / `useRadioStreams.ts` ✦
- [x] `hooks/useSystemHealth.ts` ✦ / `useTrailHydration.ts`
- [x] `components/LoginPage.tsx` ✦
- [x] `components/Map.tsx` ✦ / `MapOverlay.tsx`
- [x] `components/layout/AlertRulesSection.tsx` / `AlertStatusBar.tsx` ✦ / `EnvBar.tsx` ✦ / `Header.tsx` ✦ / `MobileNav.tsx` ✦ / `SettingsPanel.tsx` ✦ / `SettingsPrimitives.tsx` ✦ / `Sidebar.tsx`
- [x] `components/panels/AnnotationController.tsx` ✦ / `CameraModal.tsx` / `ChannelsPanel.tsx` ✦ / `CommunityPanel.tsx` ✦ / `CustomLayersTab.tsx` / `EntityDetail.tsx` ✦ / `EntitySearchPanel.tsx` / `EnvironmentPanel.tsx` ✦ / `EventLogPanel.tsx` ✦ / `GeofenceController.tsx` ✦ / `GeofencePanel.tsx` ✦ / `IncidentsPanel.tsx` / `InfrastructureGrid.tsx` / `PlaybackController.tsx` ✦ / `TacticalAudio.tsx`
- [x] `components/panels/environment/AqiGauge.tsx` ✦ / `FireStatusCard.tsx` / `RadarMiniMap.tsx` ✦ / `SeismicCard.tsx` ✦ / `WeatherAlertCard.tsx` ✦ / `WeatherCard.tsx` ✦
- [x] `components/layers/AnnotationOverlay.tsx` ✦ / `CustomLayersLayer.tsx` ✦ / `GeofenceLayer.tsx` / `MeshLayer.tsx` / `ObservationRingLayer.tsx` ✦ / `RadarLayer.tsx` / `SmokeLayer.tsx` ✦ / `StreamGaugeLayer.tsx` / `TerrainLayer.tsx` ✦ / `TinyGSLayer.tsx`
- [x] `layers/AnnotationLayer.tsx` ✦ / `atlasIcons.ts` ✦ / `buildCameraLayer.ts` ✦ / `buildCustomLayers.ts` / `buildEntityLayers.ts` ✦ / `buildEventLayers.ts` ✦ / `buildGeofenceLayers.ts` / `buildLightningLayer.ts` ✦ / `buildMeshNodeLayer.ts` ✦ / `buildObservationRingLayer.ts` ✦ / `buildStreamGaugeLayer.ts` ✦ / `buildTinyGSLayer.ts` ✦ / `buildTrailLayers.ts` / `colorUtils.ts` ✦ / `geoUtils.ts` ✦ / `iconAtlas.ts` / `pvb.ts` ✦
- [x] `admin/AdminFeeds.tsx` ✦ / `AdminMetrics.tsx` / `AdminUsers.tsx` ✦
- [x] `admin/metrics/DbPoolPanel.tsx` ✦ / `EntityDonut.tsx` ✦ / `EventActivity.tsx` ✦ / `HealthBar.tsx` ✦ / `IngestionChart.tsx` ✦ / `LivePerformance.tsx` ✦ / `PollerGrid.tsx` ✦ / `Primitives.tsx` / `StoragePanel.tsx` ✦ / `types.ts` ✦
- [x] `entityUtils.ts` ✦ / `incidentUtils.ts` ✦ / `notifications.ts` ✦ / `snapshotExport.ts`
- [x] `tsconfig.json` ✦ / `vite.config.ts` ✦ / `nginx.conf` / `public/sw.js`

✦ = no findings

**Findings:**

---
#### Security

**[CRIT] `components/MapOverlay.tsx` — XSS via `innerHTML` with server-controlled fields**
The tooltip element is populated via `tooltip.innerHTML = html` where `html` is built by direct f-string interpolation of `t.callsign`, `t.uid`, `t.category`, `cam.name`, `cam.road`, `ev.summary`, `gauge.name`, `node.name`, `node.status`, `sat.name`, `geofence.name`, and others — all sourced from WebSocket/backend data. A compromised backend message or DB record containing `<img src=x onerror=alert(document.cookie)>` executes immediately on tooltip hover.
_Fix: Replace `tooltip.innerHTML = html` with safe DOM construction using `document.createTextNode` / `element.textContent`, or run every interpolated field through an HTML-escaping helper before insertion._

**[CRIT] `auth.ts:10,17` — Missing/malformed token silently falls through to `'admin'` role**
`getUserRole()` returns `'admin'` when no token is present (line 10) and again inside the `catch` block (line 17). An unauthenticated visitor, a user with a corrupt token, and a token without a `role` claim all receive admin privileges in every client-side role gate.
_Fix: Return `'viewer'` as the safe fallback on missing or unparseable tokens._

**[HIGH] `main.tsx:10` — Admin route guard relies on the broken `getUserRole()`**
`if (isAdmin && getUserRole() !== 'admin') { window.location.replace('/') }` — because `getUserRole()` returns `'admin'` on a missing token, an unauthenticated browser visiting `/admin` passes the check and renders the full admin UI.
_Fix: Fix `getUserRole()` first. Also ensure every admin API endpoint enforces server-side JWT validation so the admin UI can't perform destructive operations without a valid token._

**[HIGH] `auth.ts:21` — JWT sent as URL query parameter on WebSocket connection**
`wsTokenParam()` appends `?token=<jwt>` to the WebSocket URL. Tokens in query strings appear in server access logs, browser history, and `Referer` headers — effectively durable credentials at rest in logs.
_Fix: Pass the JWT in the first WebSocket message frame after connection opens (`{type:"auth",token:...}`), or exchange for a short-lived opaque ticket from a `/ws/ticket` endpoint._

**[HIGH] `hooks/useWebSocket.ts:55` — Unguarded `JSON.parse` silently kills all real-time updates**
A single malformed WebSocket frame throws an unhandled `SyntaxError` inside `onmessage`. The connection stays open but `onmessage` is never re-attached, so the app silently stops receiving all real-time updates for the rest of the session.
_Fix: Wrap in try/catch, log the error, and `return` early on bad frames._

**[HIGH] `hooks/useWebSocket.ts:~70` — Fixed 3 s reconnect with no backoff or cap**
Every disconnect schedules a 3 s reconnect forever, hammering the server during sustained outages with no exponential backoff.
_Fix: Implement exponential backoff starting at 1 s, doubling each attempt, capped at 60 s, reset on successful connection._

**[HIGH] `components/layers/MeshLayer.tsx:~40` — MapLibre event listeners accumulate on every re-render**
`map.on('click', ...)`, `map.on('mouseenter', ...)`, `map.on('mouseleave', ...)` registered in a `useEffect` with no cleanup return. Each dependency change adds a new set of listeners without removing the previous ones — after 10 renders, 30 listeners fire on every map interaction.
_Fix: Capture handler references in `const` before registering and return `() => { map.off(...) }` from the effect._

**[HIGH] `components/layers/TinyGSLayer.tsx:~35,~65` — MapLibre listeners never removed**
Both `useEffect` calls register click/hover events with no `map.off(...)` cleanup. Same unbounded accumulation as `MeshLayer.tsx`.
_Fix: Same pattern — capture and remove handlers in effect cleanup._

**[HIGH] `components/layers/StreamGaugeLayer.tsx:~30` — MapLibre listeners never removed**
Click and hover events registered without cleanup. Same issue.
_Fix: Same pattern._

**[HIGH] `components/panels/CameraModal.tsx:~45` — Camera image/iframe URL sourced from backend without protocol check**
`src={selectedCam.ldi_url ?? selectedCam.url}` sets an `<img>` / `<iframe>` src directly from the store. A `javascript:` or `data:text/html` URL in a camera record reaches the element unchecked.
_Fix: Validate before use: `const safe = /^https?:\/\//i.test(url) ? url : ''`._

---
#### Correctness

**[MED] `App.tsx:129` — Network error on auth check silently grants full access**
`.catch(() => { setAuthed(true); setAuthChecked(true) })` — a backend outage or DNS failure admits the user as authenticated, bypassing the login gate entirely.
_Fix: On fetch failure, set `authed = false` and show an error state rather than granting access._

**[MED] `components/layout/Sidebar.tsx:77,335` — Unvalidated `href` from server RSS data**
`href={incident.link}` renders an anchor whose URL comes from the RSS/feed pipeline without protocol validation. A `javascript:` link executes on click.
_Fix: `const safeLink = /^https?:\/\//i.test(link) ? link : '#'`. Apply `rel="noopener noreferrer"` to all external links._

**[MED] `components/panels/IncidentsPanel.tsx:~50,~90` — Unvalidated `href` + ReactMarkdown trust surface**
Same unvalidated `href={incident.link}` risk. AI-generated `summary.summary` is passed to `<ReactMarkdown>` — safe today but any future addition of `rehype-raw` would enable arbitrary HTML from model output.
_Fix: Validate all `href` values. Add an explicit comment in the `ReactMarkdown` call prohibiting `rehype-raw`._

**[MED] `components/panels/environment/FireStatusCard.tsx:65` — Unvalidated `href` from fire entity link**
`href={fire.link}` from an RSS/API-sourced field. Same protocol-validation gap.
_Fix: Same validation as above._

**[MED] `components/layout/AlertRulesSection.tsx:~80` — Webhook URL submitted without client-side scheme check**
Form input is POSTed to the backend without validating `https?://`. Defence-in-depth requires the client to reject non-HTTP(S) schemes.
_Fix: Reject on submit if `!/^https?:\/\//i.test(webhookUrl)`._

**[MED] `components/panels/TacticalAudio.tsx:~55` — Audio stream URL from backend without protocol validation**
`selectedStream.url` from the backend radio config is set as `<audio src>` without a scheme check.
_Fix: Validate before assignment._

**[MED] `hooks/useTrailHydration.ts:~15` — `fetchedRef` Set grows unbounded**
Records every entity UID whose trail has been fetched and is never pruned when entities leave the store. Accumulates indefinitely over a long session with many transient aircraft.
_Fix: On each fetch cycle, remove entries from `fetchedRef` for UIDs no longer present in the entity store._

**[MED] `hooks/useTrailHydration.ts:~40` — In-flight fetch has no abort on unmount**
No `AbortController` and no mount-check guard — a fetch completing after unmount fires `refreshEntityTrack` on a stale store reference.
_Fix: Create an `AbortController` per fetch; call `controller.abort()` in the effect cleanup._

**[MED] `store.ts` — `trafficFlow: any[]`, `utilityStatus: any`, `oregonStatus: any`**
Three store slices typed `any`, bypassing strict-mode checking for all downstream consumers.
_Fix: Define minimal concrete interfaces and replace `any` with them._

**[MED] `components/layers/GeofenceLayer.tsx:~50` — MapLibre source and layers not removed on unmount**
The `'geofence-draw'` source and its layers are added but never cleaned up. On remount, attempting to re-add the same source ID throws a MapLibre error.
_Fix: Return a cleanup that conditionally calls `map.removeLayer` / `map.removeSource` for each added resource._

**[MED] `components/layers/RadarLayer.tsx:95` — Private MapLibre internal accessed via `any` cast**
`(map as any).style?.sourceCaches?.[sourceId]` accesses a private API that can silently break on any MapLibre minor version rename.
_Fix: Use the public `map.getSource(sourceId)` API._

**[MED] `layers/buildCustomLayers.ts:~30` — `hexToRgb` returns `[NaN, NaN, NaN]` for invalid hex**
No validity guard before `parseInt`. An invalid hex string produces `[NaN, NaN, NaN]` which causes WebGL rendering artifacts.
_Fix: Guard with `if (!/^#[0-9a-f]{6}$/i.test(hex)) return [100, 100, 100]`._

**[MED] `snapshotExport.ts:24` — `toDataURL()` throws unhandled `SecurityError` on cross-origin tiles**
`canvas.toDataURL()` throws when cross-origin tiles are drawn without CORS headers. The error propagates with no user-facing feedback.
_Fix: Wrap in try/catch and show an explanatory alert if the canvas is tainted._

**[MED] `admin/AdminMetrics.tsx:25` — Stale `authHeaders()` captured in `useCallback` closures**
`const h = authHeaders()` evaluated once at render time and closed over by all five fetch callbacks. A token refresh while the component is mounted causes stale credentials to be used for all subsequent interval fetches.
_Fix: Call `authHeaders()` inside each fetch function, not at the top of the component._

---
#### Code Quality

**[LOW] `store.ts` — Variable shadowing: filter callback parameter `s` shadows outer state `s`**
`.filter((s) => now - s.ts < WINDOW_MS)` — inner `s` shadows the Zustand state parameter. A future reader adding a reference to the outer `s` inside the callback would get a silent bug.
_Fix: Rename inner parameter: `.filter((strike) => now - strike.ts < WINDOW_MS)`._

**[LOW] `config.ts:~5` — Runtime-fetched external map style URL with no integrity pinning**
`MAP_STYLE` fetches from `tiles.openfreemap.org` at runtime. A compromised CDN could redirect `glyphs`, `sprite`, and `sources` to attacker-controlled resources.
_Fix: Self-host the style JSON in `public/` or pin a specific frozen version._

**[LOW] `storeTypes.ts:154` — `SystemEvent.details` index signature typed `any`**
`[key: string]: any` silently bypasses strict-mode checks on all callers that access unknown detail keys.
_Fix: Change to `[key: string]: unknown` to force callers to narrow before use._

**[LOW] `hooks/useEntities.ts:~10` — `Object.values(...).filter(...)` creates a new array on every store subscription tick**
Zustand's shallow equality always detects a change because a new array reference is returned, re-rendering all consumers even when entity data is unchanged.
_Fix: Use a memoized selector with Zustand's `shallow` comparator._

**[LOW] `components/panels/CustomLayersTab.tsx:~60` — No file size limit on KML/GeoJSON upload**
A 500 MB GeoJSON fed to `JSON.parse` blocks the main thread and can OOM the tab.
_Fix: Check `file.size > 10 * 1024 * 1024` before reading and show an error._

**[LOW] `components/panels/EntitySearchPanel.tsx:145` — Dead conditional `const showList = true`**
Hardcoded `true` makes the conditional branch always render; the variable serves no purpose.
_Fix: Remove the variable and render the list directly._

**[LOW] `layers/iconAtlas.ts` vs `layers/atlasIcons.ts` — Two parallel icon atlas implementations**
`iconAtlas.ts` (3×2 canvas shapes) is fully superseded by `atlasIcons.ts` but still exported. A wrong import silently serves a reduced icon set with no type error.
_Fix: Delete `iconAtlas.ts` if fully superseded, or mark it deprecated._

**[NIT] `layers/buildGeofenceLayers.ts:37` — `(g.geojson_polygon as any)` repeated unnecessarily**
Two `as any` casts to access `.type` and `.coordinates`. Type `geojson_polygon` as `GeoJSON.Geometry` to eliminate both.

**[NIT] `layers/buildTrailLayers.ts:94-98` — Double `as any` cast for `PathStyleExtension` typing gap**
Known upstream Deck.gl typing issue. Add a comment explaining the workaround and track the upstream issue.

**[NIT] `admin/metrics/Primitives.tsx:26` — SVG gradient ID uses `Math.random()` on every render**
Risk of ID collisions in lists; React StrictMode doubles frequency. Use React 18's `useId()` hook instead.

**[NIT] `components/panels/IncidentsPanel.tsx` / `Sidebar.tsx` / `InfrastructureGrid.tsx` — Duplicated incident formatting helpers**
`formatIncidentLocation` and equivalent title-derivation logic appear in at least three files independently.
_Fix: Extract to `src/utils/incidentFormatters.ts`._

**[NIT] `nginx.conf:43` — `/op25/` proxy has no access restriction**
Comment says "admin use only" but the config enforces nothing — any user reaching the Nginx port can access the OP25 terminal.
_Fix: Add `allow <admin_subnet>; deny all;` or HTTP basic auth._

**[NIT] `public/sw.js:3` — Service worker has no `activate` handler**
Without `self.clients.claim()` in activate, old SW versions keep running until all tabs are closed.
_Fix: Add `self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))`._

---

## 4. Database (`db/`)

**Files reviewed:**
- [x] `db/init/01_schema.sql`
- [x] `db/init/02_geofences.sql`
- [x] `db/init/03_sources.sql`
- [x] `db/init/04_entity_mission_tags.sql`
- [x] `db/init/05_annotations.sql`

**Findings:**

**[HIGH] `01_schema.sql:116-121` — Default role `'admin'` on every new `users` INSERT**
`role VARCHAR(32) NOT NULL DEFAULT 'admin'` — any INSERT that omits the role column silently creates an admin account. A typo or missing parameter in application code grants administrative access by accident.
_Fix: Change the default to `'viewer'` (least-privilege)._

**[HIGH] `01_schema.sql:106-109` — `purge_old_observations()` has no privilege restriction**
The function is callable by any connected role with no GRANT/REVOKE, carries no `SECURITY DEFINER`, and produces no audit trail. Exposed through a connection pool bug it becomes a data-destruction vector.
_Fix: Add `SECURITY DEFINER SET search_path = public`, REVOKE EXECUTE from PUBLIC, GRANT EXECUTE only to the application role._

**[HIGH] `01_schema.sql:51-64` — `events.entity_id` has no foreign key to `entities`**
`entity_id VARCHAR(64)` on `events` is nullable with no `REFERENCES entities(entity_id)` constraint, despite being the join column. Orphaned event rows for deleted entities accumulate silently.
_Fix: Add `REFERENCES entities(entity_id) ON DELETE SET NULL` (keeping nullable for system-level events)._

**[MED] `04_entity_mission_tags.sql:2-9` — `entity_mission_tags.entity_id` has no foreign key**
Tags for deleted or non-existent entities accumulate indefinitely with no constraint to catch them.
_Fix: Add `REFERENCES entities(entity_id) ON DELETE CASCADE`._

**[MED] `01_schema.sql:28-42` — `observations.lat` / `lon` / `geom` all nullable with no consistency constraint**
All three columns are nullable independently. A row with `lat`/`lon` set but `geom = NULL` is skipped by the spatial index; a row with `geom` set but `lat`/`lon` NULL is invisible to non-spatial queries. The schema allows four inconsistent states.
_Fix: Add `CHECK ((lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (geom IS NULL))` to enforce all-or-nothing, or drop `lat`/`lon` and derive them from `geom` in a view._

**[MED] `01_schema.sql:69-84` — `geofences.geom` typed `GEOMETRY(POLYGON,4326)` but table also stores circles**
Circle-type geofences cannot be stored as a typed POLYGON geometry — the INSERT will either fail with a type mismatch or silently store an approximation. No CHECK constraint enforces which columns must be non-null per shape type.
_Fix: Change `geom` to `GEOMETRY(GEOMETRY, 4326)` (untyped). Add CHECK constraints per `geofence_shape` value._

**[MED] `01_schema.sql:123` — `ix_users_username` index is redundant with the UNIQUE constraint**
`UNIQUE NOT NULL` on `username` already creates an implicit B-tree index. The explicit `CREATE INDEX` doubles write overhead for zero query benefit.
_Fix: Drop `ix_users_username`._

**[MED] `02_geofences.sql:4` — Seed INSERTs are not idempotent**
No `ON CONFLICT DO NOTHING` guard. Re-running init (e.g., after a partial failure) silently creates duplicate geofence rows since `name` has no UNIQUE constraint.
_Fix: Add `UNIQUE(name)` to `geofences` and change INSERT to `ON CONFLICT (name) DO NOTHING`._

**[MED] `03_sources.sql:18-28` — `news_feeds.url` is nullable with no explanation**
Every other URL column in the file is `NOT NULL`. A NULL URL is silently skipped by the poller and indistinguishable from a misconfiguration.
_Fix: Add `NOT NULL` to `news_feeds.url` unless nullable URLs are intentionally documented._

**[LOW] `01_schema.sql:52` — `gen_random_uuid()` used while `uuid-ossp` is also installed**
The schema installs `uuid-ossp` (line 5) for UUID generation but uses the built-in `gen_random_uuid()` everywhere. The extension is loaded without being used anywhere.
_Fix: Either use `uuid_generate_v4()` from `uuid-ossp` consistently, or remove the extension install and rely solely on the built-in._

**[LOW] `01_schema.sql:89-99` — `alert_rules.action_config` JSONB stores webhook URLs and secrets in plaintext**
Any role with SELECT on `alert_rules` (including pg_dump) sees credentials in cleartext. No comment warns against storing secrets here.
_Fix: Document that secrets must be stored as references (env vars, Vault) rather than inline values. Consider a CHECK constraint rejecting keys named `token`, `secret`, or `password`._

**[LOW] `04_entity_mission_tags.sql:13-16` — Schema evolution via `ALTER TABLE` scattered across init files**
`cooldown_seconds`, `max_per_hour`, and `dedup_key` are added to `alert_rules` here rather than in the original `CREATE TABLE` in `01_schema.sql`. The authoritative column list for `alert_rules` is now split across two files.
_Fix: Move these columns into the `CREATE TABLE alert_rules` in `01_schema.sql`. Use a proper migration tool (Alembic) for runtime schema changes._

**[LOW] `05_annotations.sql:1-14` — `annotations.created_by` has no FK to `users`**
`created_by VARCHAR(64)` is nullable with no `REFERENCES users(username)`. Renaming or deleting a user leaves annotations with a stale username string. Same issue in `entity_mission_tags.created_by`.
_Fix: Add `REFERENCES users(username) ON DELETE SET NULL`, or store `users.id` for rename-safety._

**[NIT] `01_schema.sql:74` — `geofence_shape` naming inconsistent with all other `*_type` columns**
Every other discriminator in the schema is named `*_type`; this one is `geofence_shape`.
_Fix: Rename to `shape_type` for consistency._

**[NIT] `03_sources.sql:31-43` — `poller_sources` has no UNIQUE constraint on `(type, name)`**
Nothing prevents duplicate rows with identical type and name, preventing safe `ON CONFLICT` upserts.
_Fix: Add `UNIQUE(type, name)`._

**[NIT] `03_sources.sql:45-52` — `alert_zone_configs` missing index on `enabled`**
All other source tables have an index on `enabled`; this one does not, inconsistent with expected `WHERE enabled = TRUE` queries.
_Fix: Add `CREATE INDEX IF NOT EXISTS ix_alert_zone_configs_enabled ON alert_zone_configs (enabled)`._

---

## 5. Cross-Cutting

**Areas checked:**
- [x] Backend API routes vs. frontend `config.ts` endpoint paths — ✅ Clean
- [x] Redis channel names: `redis_bus.py` vs. `poller/bus.py` — ✅ Clean
- [x] `.env.example` completeness vs. all config.py fields — 2 gaps
- [x] Docker Compose health checks and dependency ordering — ✅ Clean
- [x] `docker-compose.yml` vs. `docker-compose.dev.yml` drift — 1 gap

**Findings:**

**[LOW] `.env.example` documents `REGION_ALT=100ft` but no `config.py` reads it**
`REGION_ALT` appears in `.env.example:29` but is declared in neither `backend/config.py` nor `poller/config.py`. It is silently ignored by both services, giving operators a false belief that it does something.
_Fix: Either add `region_alt: str = "100ft"` to the relevant config, or remove `REGION_ALT` from `.env.example`._

**[LOW] `VITE_RADAR_FALLBACK_MAX_ZOOM` and `VITE_RADAR_FALLBACK_LAYER` not plumbed through Docker build args**
`frontend/src/config.ts` reads both `import.meta.env.VITE_RADAR_FALLBACK_MAX_ZOOM` and `import.meta.env.VITE_RADAR_FALLBACK_LAYER`, but neither is declared as a build arg in `docker-compose.yml` (lines 99-106) nor documented in `.env.example`. Both always resolve to their hardcoded defaults in a production Docker build — operators have no way to override them.
_Fix: Add both to `docker-compose.yml` `frontend.build.args` (e.g. `VITE_RADAR_FALLBACK_MAX_ZOOM: ${VITE_RADAR_FALLBACK_MAX_ZOOM:-6}`) and add corresponding entries to `.env.example`._

**[LOW] `docker-compose.dev.yml` missing `VITE_RADIO_STREAM_URL`**
Production compose (`docker-compose.yml:104`) passes `VITE_RADIO_STREAM_URL` as a frontend build arg, but `docker-compose.dev.yml` omits it from its `frontend.environment` block. Operators using the dev stack always get the hardcoded fallback `/stream/radio.mp3` regardless of their `.env` configuration.
_Fix: Add `VITE_RADIO_STREAM_URL: ${VITE_RADIO_STREAM_URL:-/stream/radio.mp3}` to `frontend.environment` in `docker-compose.dev.yml`._

**[NIT] `poller/config.py` `adsb_enrichment_cache_dir` has no `.env.example` entry**
The field defaults to `/data` (which matches the Docker volume mount) so this is benign, but an operator wanting to override the path has no hint the variable exists.
_Fix: Add `# ADSB_ENRICHMENT_CACHE_DIR=/data` (commented out) to `.env.example` near the other `ADSB_*` entries._

**Clean areas (no findings):**
- Redis channels: `poller/bus.py` publishes only to `"civic:updates"`; `backend/redis_bus.py` subscribes only to `"civic:updates"`. ✅
- Backend API routes vs frontend: all routes mounted at `/api/v1` match the frontend `API_BASE = '/api/v1'`; the WebSocket at `/ws` (no prefix) matches `WS_URL` construction. ✅
- Docker Compose dependency chain: `db` and `redis` both have health checks; `backend` and `poller` gate on `service_healthy`; `frontend` gates on `backend:healthy`. ✅

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
| 3 | 2026-05-08 | 2 CRIT, 8 HIGH, 14 MED, 7 LOW, 6 NIT | 80 (all of `frontend/`) |
| 4 | 2026-05-08 | 0 CRIT, 3 HIGH, 6 MED, 5 LOW, 3 NIT | 5 (all of `db/init/`) |
| 5 | 2026-05-08 | 0 CRIT, 0 HIGH, 0 MED, 3 LOW, 1 NIT | Cross-cutting contracts, env, Docker |

### Session 5 Highlights (Cross-Cutting)
The cross-cutting pass found no critical or high-severity contract mismatches — the most important boundaries are clean. Redis pub/sub is solid: the poller publishes exclusively to `"civic:updates"` and the backend subscribes to exactly that channel. The Docker Compose dependency chain is correct with proper `service_healthy` gates throughout. Three low-severity gaps exist in environment configuration: `REGION_ALT` in `.env.example` is a dead variable no config.py reads; `VITE_RADAR_FALLBACK_MAX_ZOOM` and `VITE_RADAR_FALLBACK_LAYER` are read by `config.ts` but never plumbed through Docker build args, making them silently unconfigurable in production; and `docker-compose.dev.yml` drops `VITE_RADIO_STREAM_URL` relative to the production compose, causing the audio stream URL override to silently not work in dev.

### Session 4 Highlights
The schema is functional and the spatial plumbing is correctly in place, but has two systemic weaknesses. First, referential integrity is selectively enforced — FKs exist where tables were written carefully but are missing where columns were added later (`events.entity_id`, `entity_mission_tags.entity_id`, `annotations.created_by`), creating silent orphan-accumulation paths. Second, the `users` table defaults the role to `'admin'`, meaning any application-layer INSERT that omits the role grants admin access silently. The geofence geometry model is technically inconsistent (`POLYGON`-typed column used for both polygons and circles), and seed data in `02_geofences.sql` will create duplicates on any second run. Schema evolution via `ALTER TABLE` scattered across numbered init files will make future changes fragile.

### Session 3 Highlights
The most critical issue is XSS via `innerHTML` in `MapOverlay.tsx`: every map tooltip interpolates server-controlled entity fields directly into the DOM with no sanitization — a single compromised WebSocket message achieves full XSS. The second critical cluster is `auth.ts`, where missing and malformed tokens both silently resolve to `'admin'`, which combined with the client-only admin route guard in `main.tsx` means the admin UI is currently accessible to unauthenticated users. Three map layer components (`MeshLayer`, `TinyGSLayer`, `StreamGaugeLayer`) leak MapLibre event listeners on every re-render and `GeofenceLayer` doesn't clean up its source/layers on unmount. The WebSocket handler's unguarded `JSON.parse` creates a silent total failure mode on a single bad frame. The recurring theme across the frontend is unvalidated `href` URLs from RSS/feed data rendered in `Sidebar`, `IncidentsPanel`, and `FireStatusCard`. 27 of 80 files were completely clean.

### Session 2 Highlights
The backend is well-structured with correct parameterised queries and async session handling throughout. The most serious cluster is the **auth system**: empty secret-key default allows trivially-forged JWTs, any token missing the `role` claim silently becomes admin, JWT decode logic is duplicated in three independent places, and the entire `/api/v1/auth/` prefix bypasses `AuthMiddleware` including user-management routes. The **webhook/alertrule subsystem** is a second critical cluster: SSRF via stored URLs with zero host validation, non-atomic Redis rate-limiting, and the dispatcher dying permanently on any Redis disconnect. The unauthenticated Prometheus `/metrics` and fully-public admin endpoints (when auth is off, the default) round out the high-priority items. 11 of 38 files were completely clean.

### Session 1 Highlights
The poller is well-structured overall — consistent parameterised DB queries throughout, working `sanitize_payload()` at every ingestion boundary, and reasonable error handling in most pollers. The most urgent issues are: a SQL injection in `purge_observations()` (Redis-controlled integer string-formatted into an SQL interval), XML injection in the CoT emitter that affects every connected ATAK/WinTAK client, an indirect prompt injection vector in the AI summary poller, and a database schema mismatch in the anomaly poller that silently discards all anomaly event history. Several reliability gaps: `geofence._entity_state` and `seismic._seen_ids` are unbounded in memory; CoT receiver buffer is unbounded; APRS TCP read has no timeout. The TAT formula in `beast_decoder.py` produces physically impossible values (~−300°C). Haversine is duplicated five times and should be consolidated into `normalizers.beast_math`.
