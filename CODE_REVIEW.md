# Vertex Code Review Tracker

**Started:** 2026-05-08  
**Reviewer:** Claude (claude-sonnet-4-6)  
**Goal:** Security, correctness, and code quality across all containers

---

## Review Order

| # | Scope | Status | Session |
|---|-------|--------|---------|
| 1 | `poller/` — external ingestion, normalizers, geofence | 🔄 In Progress | 2026-05-08 |
| 2 | `backend/` — API surface, auth, WebSocket | ⬜ Not Started | — |
| 3 | `frontend/` — TypeScript, Zustand, XSS vectors | ⬜ Not Started | — |
| 4 | `db/` — init SQL, schema, indexes | ⬜ Not Started | — |
| 5 | Cross-cutting — API contracts, Redis channels, env/config | ⬜ Not Started | — |

---

## 1. Poller (`poller/`)

**Files reviewed:**
- [ ] `main.py`
- [ ] `config.py` / `config_loader.py` / `config_watcher.py` / `config_sync.py`
- [ ] `db.py`
- [ ] `geofence.py`
- [ ] `bus.py`
- [ ] `sanitize.py`
- [ ] `pollers/base.py`
- [ ] `pollers/adsb.py`
- [ ] `pollers/ais.py`
- [ ] `pollers/alerts.py`
- [ ] `pollers/anomaly.py`
- [ ] `pollers/aprs.py`
- [ ] `pollers/beast_transport.py`
- [ ] `pollers/cot_emitter.py` / `cot_receiver.py`
- [ ] `pollers/fire.py`
- [ ] `pollers/lightning.py`
- [ ] `pollers/meshcore.py`
- [ ] `pollers/news.py`
- [ ] `pollers/p25.py`
- [ ] `pollers/seismic.py`
- [ ] `pollers/streamgauge.py`
- [ ] `pollers/summary.py`
- [ ] `pollers/tinygs.py`
- [ ] `pollers/traffic.py`
- [ ] `pollers/utilities.py`
- [ ] `pollers/weather.py`
- [ ] `normalizers/aircraft.py`
- [ ] `normalizers/bds_decoders.py`
- [ ] `normalizers/beast_decoder.py`
- [ ] `normalizers/beast_math.py`
- [ ] `normalizers/mesh_node.py`
- [ ] `normalizers/vessel.py`
- [ ] `normalizers/weather.py`
- [ ] `enrichment/adsbdb.py`
- [ ] `enrichment/aircraft_db.py`
- [ ] `enrichment/airlines_db.py`
- [ ] `enrichment/airports_db.py`
- [ ] `enrichment/cache.py`
- [ ] `enrichment/metar.py`
- [ ] `enrichment/navaids_db.py`
- [ ] `enrichment/route_plausibility.py`

**Findings:**

<!-- Format: [SEVERITY] file:line — description -->
<!-- SEVERITY: CRIT / HIGH / MED / LOW / NIT -->

_None logged yet._

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
| 1 | 2026-05-08 | TBD | TBD |
