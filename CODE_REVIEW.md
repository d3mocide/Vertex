# Vertex Code Review Tracker

**Started:** 2026-05-08  
**Reviewer:** Claude (claude-sonnet-4-6)  
**Goal:** Security, correctness, and code quality across all containers

---

## Review Order

| # | Scope | Status | Session |
|---|-------|--------|---------|
| 1 | `poller/` — external ingestion, normalizers, geofence | ✅ Complete | 2026-05-08 |
| 2 | `backend/` — API surface, auth, WebSocket | ⬜ Not Started | — |
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
- [ ] `main.py`
- [ ] `config.py` / `config_loader.py` / `config_writer.py`
- [ ] `auth_middleware.py`
- [ ] `deps.py`
- [ ] `rate_limit.py`
- [ ] `redis_bus.py`
- [ ] `webhook_dispatcher.py`
- [ ] `metrics_collector.py`
- [ ] `db/models.py`
- [ ] `db/session.py`
- [ ] `schemas/entity.py` / `event.py` / `observation.py`
- [ ] `routers/auth.py`
- [ ] `routers/admin.py`
- [ ] `routers/ws.py`
- [ ] `routers/entities.py`
- [ ] `routers/observations.py`
- [ ] `routers/events.py`
- [ ] `routers/geofences.py`
- [ ] `routers/alerts.py`
- [ ] `routers/alertrules.py`
- [ ] `routers/aircraft.py`
- [ ] `routers/annotations.py`
- [ ] `routers/entity_tags.py`
- [ ] `routers/health.py`
- [ ] `routers/layers.py`
- [ ] `routers/news.py`
- [ ] `routers/radio.py`
- [ ] `routers/sitrep.py`
- [ ] `routers/sources.py`
- [ ] `routers/summary.py`
- [ ] `routers/traffic.py`
- [ ] `routers/utilities.py`
- [ ] `routers/weather.py`
- [ ] `tests/test_geofences_crud.py`

**Findings:**

_None logged yet._

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

### Session 1 Highlights
The poller is well-structured overall — consistent parameterised DB queries throughout, working `sanitize_payload()` at every ingestion boundary, and reasonable error handling in most pollers. The most urgent issues are: a SQL injection in `purge_observations()` (Redis-controlled integer string-formatted into an SQL interval), XML injection in the CoT emitter that affects every connected ATAK/WinTAK client, an indirect prompt injection vector in the AI summary poller, and a database schema mismatch in the anomaly poller that silently discards all anomaly event history. Several reliability gaps: `geofence._entity_state` and `seismic._seen_ids` are unbounded in memory; CoT receiver buffer is unbounded; APRS TCP read has no timeout. The TAT formula in `beast_decoder.py` produces physically impossible values (~−300°C). Haversine is duplicated five times and should be consolidated into `normalizers.beast_math`.
