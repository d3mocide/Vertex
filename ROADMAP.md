# Vertex — Strategic Roadmap

> **Scope:** Forward-looking feature roadmap as of May 2026.
> Historical bug fixes and M1–M6 milestone items are tracked in `FEATURES_AND_ROADMAP.md`.
> All items in that document are complete.

---

## Current Baseline

Vertex is fully operational across all core and extended systems:

| System | Status |
|--------|--------|
| 14 async pollers (ADS-B/BEAST, AIS, P25, weather, alerts, traffic, utilities, news, meshcore, seismic, fire, APRS, AI summary, anomaly detection) | Production |
| CoT emitter (TAK/ATAK UDP multicast output) | Production |
| FastAPI REST + WebSocket backend (70+ endpoints) | Production |
| React/MapLibre/Deck.gl frontend (14 panels, full map stack) | Production |
| PostgreSQL + PostGIS persistence, Redis pub/sub | Production |
| JWT authentication with viewer role, rate limiting, Prometheus metrics | Production |
| AI situational summary + anomaly detection (LiteLLM, cloud or local) | Production |
| Admin metrics dashboard (poller heartbeats, ingestion rates, DB pool, storage) | Production |
| Geospatial event mapping (seismic events on map with Deck.gl ScatterplotLayer) | Production |
| BEAST/Ultrafeeder deep integration (CPR decode, trail smoothing, enrichment stack) | Production |
| Outbound webhooks + alerting rules engine | Production |
| Talkgroup management UI (name, priority, scan list) | Production |
| SitRep export (Markdown, time-windowed) | Production |
| KML / GeoJSON custom layer import | Production |
| Offline map tiles (tileserver-gl, `--profile offline`) | Production |
| Grafana + Prometheus dashboards (`--profile monitoring`) | Production (optional) |
| Pytest suite (backend CRUD, poller normalization, geofence state machine) | Production |
| Multi-platform Docker Compose (amd64 / arm64) | Production |

---

## Phase 1 — Complete

All 18 original roadmap items are done. Summary:

| ID | Item | Status |
|----|------|--------|
| A1 | Fire / Smoke Overlays | Done |
| A2 | APRS / HAM Tracking | Done |
| A3 | Seismic Feed (USGS) | Done |
| B1 | Outbound Webhooks / Alerting Rules | Done |
| B2 | TAK / Cursor-on-Target (CoT) Output | Done |
| B3 | AI Anomaly Detection | Done |
| B4 | SitRep Export | Done |
| C1 | Playback Event Markers | Done |
| C2 | Entity Detail Sparklines | Done |
| C3 | Geofence Circles + Dwell | Done |
| C4 | P25 Talkgroup Management | Done |
| C5 | Camera Health Monitoring | Done |
| C6 | Multi-Role Auth (Viewer) | Done |
| D1 | Offline Map Tiles | Done |
| D2 | Data Retention UI | Done |
| D3 | KML / GeoJSON Import | Done |
| D4 | Test Suite | Done |
| D5 | Grafana Dashboard | Done (optional profile) |

---

## Phase 2 — Next Priorities

Vertex has moved from prototype to a mature operational tool. The next phase shifts focus from adding data sources to **tactical operator experience**: richer in-map interaction, deeper radio integration, and resilience for field deployment.

### Priority Matrix

Axes: **Impact** (operational value) × **Effort** (engineering cost).
Effort scale: XS < S < M < L < XL.

```
HIGH IMPACT
    │
    │  [Map Annotations]   [P25 Recording]  [ATAK Ingest]
    │  [Entity Tagging]    [Alert Suppress]
    │
    │  [SitRep Delivery]   [Responsive UI]  [Mesh Routing]
    │  [Snapshot Export]   [Multi-bbox]
    │
LOW IMPACT
    └────────────────────────────────────────────────
       LOW EFFORT                          HIGH EFFORT
       (XS–S)          (M)                (L–XL)
```

### Quadrant Summary

| Quadrant | Strategy | Items |
|----------|----------|-------|
| High Impact / Low Effort | **Do first** | Entity tagging, alert suppression rules, snapshot export |
| High Impact / High Effort | **Plan carefully** | Map annotations, P25 audio recording, ATAK bidirectional |
| Low Impact / Low Effort | **Fill-in work** | Scheduled SitRep delivery, panel layout persistence |
| Low Impact / High Effort | **Defer** | Multi-bbox monitoring, mesh routing visualization |

---

## Roadmap Items — Phase 2

### Category E — Tactical Operator Experience

---

#### E1 — Map Annotation Tools

- **Value:** Operators need to draw tactical areas, drop markers with notes, and sketch patrol routes directly on the map — separate from geofences (which are alert triggers). Essential for live incident management and shift briefings.
- **Implementation:**
  - New `Annotation` DB model: `type` (marker | line | polygon), `label`, `color`, `geojson`, `created_by`, `expires_at`
  - CRUD endpoints at `/api/v1/annotations`
  - Frontend: annotation draw toolbar in map controls (point, polyline, polygon); annotation layer in `Map.tsx`; label overlay; optional auto-expiry (e.g., 4h / 12h / permanent)
- **Effort:** M
- **Priority:** P1
- **Status:** Not Started

---

#### E2 — P25 Audio Archiving

- **Value:** The P25 panel streams live audio but nothing is saved. Recording talkgroup audio segments enables incident review, shift handoff playback, and timeline correlation with map events.
- **Implementation:**
  - Extend `p25.py` poller to write audio segments (per-call OPUS/MP3 chunks) to local storage under `/data/audio/{date}/{tgid}/`
  - New backend router `GET /api/v1/radio/recordings?tgid=&start=&end=` — returns paginated call list with audio URLs
  - Frontend: recording playback in `TacticalAudio.tsx` — call history tab, seekable audio player, link to map timeline at call timestamp
  - Configurable retention (default 7 days) in data retention UI
- **Effort:** L
- **Priority:** P1
- **Status:** Not Started

---

#### E3 — Entity Tagging / Mission Grouping

- **Value:** As entity counts grow (dozens of aircraft, vessels, APRS nodes), operators need to group entities by mission, agency, or threat level. A tagging system enables filtered views and focused tracking.
- **Implementation:**
  - New `EntityTag` DB model: `entity_id`, `tag`, `color`, `created_by`
  - CRUD at `/api/v1/entities/{id}/tags`
  - Frontend: tag editor in `EntityDetail.tsx`; tag filter chips in `EntitySearchPanel.tsx`; tagged entities optionally highlighted with custom color override on map
- **Effort:** S
- **Priority:** P1
- **Status:** Not Started

---

#### E4 — Alert Suppression / Cooldown Rules

- **Value:** The webhook alerting system fires on every matching event. In high-activity scenarios (convoy moving through multiple geofences, storm with many seismic events) this produces alert storms. Cooldown and deduplication rules per alert type reduce noise without sacrificing coverage.
- **Implementation:**
  - Extend `AlertRule` model with `cooldown_seconds` (suppress re-fires), `max_per_hour`, `dedup_key` (template string grouping similar events)
  - `webhook_dispatcher.py`: track last-fire timestamp per rule+entity in Redis; skip dispatch if within cooldown window
  - Frontend: cooldown and dedup fields in the Alert Rules settings section
- **Effort:** S
- **Priority:** P1
- **Status:** Not Started

---

#### E5 — Dashboard Snapshot Export

- **Value:** One-click PNG or PDF export of the current map view with overlaid entities, geofences, and panel state. Used for briefings, incident documentation, and archiving.
- **Implementation:**
  - Frontend: `html2canvas` or MapLibre GL `getCanvas()` capture of the map view + Deck.gl canvas composite
  - Optional: include active panel (e.g., Environment, Event Log) as sidebar in the export image
  - "Export snapshot" button in the header toolbar
- **Effort:** S
- **Priority:** P2
- **Status:** Not Started

---

### Category F — Radio & TAK Integration

---

#### F1 — ATAK Bidirectional (CoT Ingest)

- **Value:** Vertex currently emits CoT to the TAK ecosystem. Receiving CoT position reports from ATAK clients (field operators with Android/iOS) would display them on the Vertex map — completing true two-way TAK integration.
- **Implementation:**
  - New `cot_receiver.py` worker — UDP multicast listener on `239.2.3.1:6969`; parse CoT XML; normalize to Entity model (`entity_type = "tak_client"`)
  - Config: `COT_RECEIVE_ENABLED`, `COT_RECEIVE_ADDR` in `poller/config.py`
  - Frontend: TAK client icon style in `iconAtlas.ts`; TAK clients filterable in `EntitySearchPanel`
- **Effort:** M
- **Priority:** P1
- **Status:** Not Started

---

#### F2 — Talkgroup Scan Priority Enforcement

- **Value:** The talkgroup management UI allows setting priority 1–5 per TGID, but the P25 poller doesn't use it. Enforcing scan priority order (higher priority talkgroups break-in over lower ones) makes the radio panel operationally useful.
- **Implementation:**
  - `p25.py` poller: fetch active talkgroup priority config from Redis on start; implement priority-weighted scan slot allocation
  - Frontend: active/priority indicator in `TacticalAudio.tsx` updates in real-time as the poller scans
- **Effort:** M
- **Priority:** P2
- **Status:** Not Started

---

### Category G — Deployment & Resilience

---

#### G1 — Scheduled SitRep Delivery

- **Value:** Automatic SitRep generation and delivery (email, Slack webhook, or local file drop) on a schedule (e.g., every 6h, or at shift change). Removes the manual step from shift handoff workflows.
- **Implementation:**
  - Extend `AlertRule` model to support `action_type = "sitrep_delivery"` with schedule (cron string) and delivery config (URL/email)
  - New APScheduler job in `poller/main.py` reading scheduled sitrep rules from DB
  - Calls existing `/api/v1/sitrep` endpoint internally and dispatches result
- **Effort:** S
- **Priority:** P2
- **Status:** Not Started

---

#### G2 — Mobile-Responsive Layout

- **Value:** The Pi is often accessed from phones and tablets in the field. The current layout is optimized for desktop/landscape. A responsive breakpoint (≤768px) with a simplified single-panel mobile view enables field use from a handset.
- **Implementation:**
  - TailwindCSS responsive prefixes on `App.tsx`, `Sidebar.tsx`, `Header.tsx`
  - Mobile: sidebar collapses to bottom tab bar; map full-screen; single active panel at a time; simplified header
  - Touch-friendly geofence draw (tap to place vertices)
- **Effort:** L
- **Priority:** P2
- **Status:** Not Started

---

#### G3 — Panel Layout Persistence

- **Value:** Operators rearrange panels to match their workflow but every reload resets to default. Persisting panel open/closed state and any resizable splits to `localStorage` (or user profile in DB) removes the setup tax from each session.
- **Implementation:**
  - Zustand `persist` middleware writing panel state to `localStorage`
  - Per-user DB preference store: `UserPreference` model with `key`/`value` JSON at `/api/v1/auth/preferences`
  - Sync on login, fall back to localStorage when unauthenticated
- **Effort:** S
- **Priority:** P3
- **Status:** Not Started

---

## Tracking Table — Phase 2

| ID | Item | Category | Effort | Impact | Priority | Status |
|----|------|----------|--------|--------|----------|--------|
| E1 | Map Annotation Tools | Tactical UX | M | High | P1 | Done |
| E2 | P25 Audio Archiving | Tactical UX | L | High | P1 | Done |
| E3 | Entity Tagging / Mission Grouping | Tactical UX | S | High | P1 | Done |
| E4 | Alert Suppression / Cooldown Rules | Tactical UX | S | High | P1 | Done |
| E5 | Dashboard Snapshot Export | Tactical UX | S | Medium | P2 | Done |
| F1 | ATAK Bidirectional (CoT Ingest) | Radio/TAK | M | High | P1 | Done |
| F2 | Talkgroup Scan Priority Enforcement | Radio/TAK | M | Medium | P2 | Done |
| G1 | Scheduled SitRep Delivery | Deployment | S | Medium | P2 | Done |
| G2 | Mobile-Responsive Layout | Deployment | L | Medium | P2 | Done |
| G3 | Panel Layout Persistence | Deployment | S | Low | P3 | Done |

---

## Suggested Sprint Order — Phase 2

### Sprint 5 — Tactical Quick Wins (P1 Low-Effort) ✓ Complete
`E3` Entity tagging · `E4` Alert suppression rules · `E5` Snapshot export

### Sprint 6 — Core Tactical Capabilities (P1 Medium-Effort) ✓ Complete
`E1` Map annotations · UX refinement pass

### Sprint 7 — Depth & Radio (P2) ✓ Complete
`E2` P25 audio archiving · `F1` ATAK CoT ingest · `F2` Scan priority enforcement · `G1` Scheduled SitRep

### Sprint 8 — Deployment Hardening (P2–P3) ✓ Complete
`G2` Mobile-responsive layout · `G3` Panel layout persistence

---

## Phase 3 — Production Readiness & Expansion

Vertex is feature-complete for tactical operations. Phase 3 hardens it for real-world production deployments, closes engineering quality gaps exposed by the audit, and adds the two deferred high-effort capabilities that operators have started requesting.

Phase 3 is organized across three categories:

- **H — Quality & Reliability:** test coverage, API consistency, security hardening
- **I — Infrastructure & Operations:** TLS, Docker resource limits, deployment tooling
- **J — New Capabilities:** deferred features now worth building (multi-region, mesh visualization)

---

## Roadmap Items — Phase 3

### Category H — Quality & Reliability

---

#### H1 — API Pagination & Filtering

- **Value:** List endpoints (`/entities`, `/alerts`, `/news`, `/events`, `/observations`) return unbounded result sets. Under real load this causes OOM crashes and slow responses. Every list endpoint needs `limit/offset` (or cursor) pagination and consistent filtering parameters.
- **Implementation:**
  - Add `limit` (default 100, max 1000) and `offset` query params to all list routers: `entities.py`, `alerts.py`, `news.py`, `events.py`, `observations.py`
  - Add bbox spatial filter (`bbox=min_lon,min_lat,max_lon,max_lat`) to `/entities` using PostGIS `ST_Within`
  - Add `hours` / `start` / `end` time filters to `/events` and `/alerts`
  - Add `LIMIT` clause to observations replay query (cap at 50,000 rows)
  - Frontend: update `EntitySearchPanel` fetch to use pagination; add "load more" affordance
- **Effort:** M
- **Priority:** P1
- **Status:** Not Started

---

#### H2 — Backend Test Suite Expansion

- **Value:** Only one test file exists (`test_geofences_crud.py`). The auth flow, entity CRUD, alert rule dispatch, WebSocket broadcast, observations replay, and geofence engine all have zero test coverage. A regression in any of these can go unnoticed until a field deployment breaks.
- **Implementation:**
  - `tests/test_auth.py` — register, login, JWT decode, viewer role enforcement, rate limit behavior
  - `tests/test_entities.py` — entity list filtering, pagination, trail fetch, tag CRUD
  - `tests/test_alertrules.py` — rule creation, webhook dispatch mock, cooldown logic, sitrep action
  - `tests/test_observations.py` — replay endpoint with time range, bbox filter, LIMIT cap
  - `tests/test_websocket.py` — connect with token, receive entity_update, geofence_event
  - `tests/test_geofence_engine.py` — entry/exit detection using mock PostGIS geometries
  - Use `pytest-asyncio`, `httpx.AsyncClient`, and fixture-based DB rollback (no data leakage between tests)
  - Add `make test` target and integrate into Docker build as a stage gate
- **Effort:** L
- **Priority:** P1
- **Status:** Not Started

---

#### H3 — CORS & Security Hardening

- **Value:** CORS origins are hardcoded to `localhost`; production deployments on a LAN or with a custom domain are silently misconfigured. No CSRF protection exists. API key auth (for non-browser clients) is absent. Password policy is unenforced.
- **Implementation:**
  - Make CORS origins configurable via `CORS_ORIGINS` env var (comma-separated, parsed by `config.py`)
  - Add `CORS_ALLOW_CREDENTIALS`, `CORS_ALLOW_METHODS` env knobs
  - Add optional static API key auth: `X-API-Key` header as an alternative to JWT (useful for poller-to-backend calls and third-party integrations); stored hashed in DB
  - Add minimum password length validation (≥12 chars) on register/change endpoints
  - Add `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options` security headers in Nginx config
  - Frontend `SettingsPanel`: show current CORS config for admin debugging
- **Effort:** S
- **Priority:** P1
- **Status:** Not Started

---

#### H4 — WebSocket Per-Client Filtering

- **Value:** Every connected client receives every entity update regardless of their active map viewport or entity type filters. On a busy deployment (500+ aircraft) this saturates slow connections (mobile, Pi 5 Wi-Fi). Server-side filtering reduces bandwidth 10–50×.
- **Implementation:**
  - Add subscription message protocol: client sends `{"type":"subscribe","bbox":[...],"entity_types":[...]}` after connect
  - Backend `ws.py`: maintain per-client filter state; apply bbox and type filter before forwarding Redis pub/sub messages
  - Client re-sends subscription on filter change (viewport pan/zoom, entity type toggle in `EntitySearchPanel`)
  - Graceful fallback: clients that send no subscription receive all events (backward compatible)
  - Frontend `useWebSocket.ts`: send subscription on mount and on filter store change
- **Effort:** M
- **Priority:** P2
- **Status:** Not Started

---

### Category I — Infrastructure & Operations

---

#### I1 — TLS / HTTPS Termination

- **Value:** JWT tokens and credentials are transmitted in plaintext over HTTP. Any LAN observer can capture session tokens. Production deployments require TLS.
- **Implementation:**
  - Add Nginx TLS config block: listen 443 ssl; `ssl_certificate` / `ssl_certificate_key` paths configurable via env (`TLS_CERT_PATH`, `TLS_KEY_PATH`)
  - Add HTTP→HTTPS redirect (301) on port 80 when TLS is enabled
  - Add `--profile tls` Docker Compose profile that mounts cert directory and enables the TLS Nginx config
  - Document self-signed cert generation for LAN use and Let's Encrypt for public deployments
  - Update `CORS_ORIGINS` default to `https://` when TLS profile active
  - Frontend: detect mixed-content and warn in `SettingsPanel` if accessing via HTTPS with `WS_URL` still `ws://`
- **Effort:** S
- **Priority:** P1
- **Status:** Not Started

---

#### I2 — Docker Resource Limits & Restart Policies

- **Value:** No memory or CPU limits are set. On a Raspberry Pi 5 (8 GB), a runaway poller or a large observations query can OOM-kill the entire stack. Containers also lack `restart: unless-stopped`, so a crash requires manual intervention.
- **Implementation:**
  - Add `restart: unless-stopped` to all service definitions
  - Add `deploy.resources.limits`: backend (512 MB / 1 CPU), poller (384 MB / 1 CPU), frontend (128 MB / 0.5 CPU), db (1 GB / 2 CPU), redis (256 MB / 0.5 CPU)
  - Add `deploy.resources.reservations` for db and redis (guaranteed floor)
  - Add `ulimits.nofile` for backend and poller (connection handle headroom)
  - Test on Pi 5 target: verify limits don't starve normal operation under ADS-B peak load (~300 aircraft)
- **Effort:** S
- **Priority:** P2
- **Status:** Not Started

---

#### I3 — Systemd Unit & Pi 5 Auto-Start

- **Value:** After a power loss the Pi 5 boots but Vertex does not restart. Operators must SSH in and run `docker compose up -d`. A systemd unit makes Vertex a true appliance.
- **Implementation:**
  - Write `infra/vertex.service` systemd unit: `After=docker.service network-online.target`; `ExecStart=docker compose -f /opt/vertex/docker-compose.yml up`; `ExecStop=docker compose down`; `Restart=on-failure`
  - Write `infra/install.sh` setup script: copies unit, enables it, sets up data directories, optionally pulls images
  - Write `infra/update.sh` upgrade script: pulls new images, restarts services with zero-downtime rolling strategy
  - Document installation in `README.md` under "Pi 5 Deployment"
- **Effort:** S
- **Priority:** P2
- **Status:** Not Started

---

### Category J — New Capabilities

---

#### J1 — Multi-Region / Multi-Bbox Monitoring

- **Value:** Operators monitoring a large corridor (e.g., I-5 from Eugene to Portland) or multiple non-contiguous areas (airport + seaport) are limited to a single bounding box. Multi-region support lets a single Vertex instance ingest and display from multiple geographic zones simultaneously.
- **Implementation:**
  - `config/sources.yml`: replace single `bbox` block with a `regions` list, each with `id`, `name`, `bbox`, and optional per-region source overrides (e.g., different ADSB feed URLs)
  - `poller/config.py`: parse `regions` list; pollers that support it iterate over regions
  - `backend/config.py`: expose `regions` via `GET /api/v1/config/regions`
  - Frontend: `Map.tsx` draws region boundary overlays as dashed rectangles; `SettingsPanel` lists active regions with entity counts
  - Entity records gain optional `region_id` foreign key; `/entities` filter accepts `region_id`
  - Start with ADS-B and weather pollers; other pollers added incrementally
- **Effort:** L
- **Priority:** P2
- **Status:** Not Started

---

#### J2 — Mesh Network Routing Visualization

- **Value:** MeshCore nodes are tracked as entities but their radio topology is invisible. Operators can see nodes on the map but cannot tell which nodes can relay messages to which, or identify weak links and coverage gaps.
- **Implementation:**
  - Extend `meshcore.py` poller to request neighbor/link-state data from MeshCore API; store in new `MeshLink` model (`node_a`, `node_b`, `snr`, `link_quality`, `updated_at`)
  - `backend/routers/mesh.py`: `GET /api/v1/mesh/links` returns current link graph; `GET /api/v1/mesh/topology` returns adjacency-list with signal quality
  - Frontend `MeshLayer.tsx`: add `LineLayer` (Deck.gl) connecting linked mesh nodes; color-coded by SNR (green=strong, amber=marginal, red=weak); toggled by existing `mesh_node` filter
  - `EntityDetail` for mesh nodes: add "Neighbors" section listing linked nodes with SNR and last-heard time
  - Optional: shortest-path overlay (highlight relay chain from selected node to any other)
- **Effort:** L
- **Priority:** P3
- **Status:** Not Started

---

#### J3 — Progressive Web App (PWA) / Installable Mobile Client

- **Value:** Mobile operators currently use the browser. A PWA adds home-screen install, offline map tile caching, and background push notifications (replacing the current browser notification model). Pairs naturally with the G2 mobile layout work.
- **Implementation:**
  - Upgrade `frontend/public/sw.js` from notification-only to full Workbox service worker with cache strategies: CacheFirst for map tiles, NetworkFirst for API calls, StaleWhileRevalidate for static assets
  - Add `frontend/public/manifest.json`: name, icons (192/512 px), theme color (`#FFB800`), `display: standalone`, `start_url`
  - `vite.config.ts`: add `vite-plugin-pwa` for asset manifest injection and SW registration
  - Backend: add Web Push VAPID key pair (stored in config); `POST /auth/push-subscription` to save subscription per user; trigger push on high-severity events
  - Frontend `SettingsPanel`: "Install app" prompt and push subscription management
- **Effort:** M
- **Priority:** P3
- **Status:** Not Started

---

## Phase 3 — Priority Matrix

```
HIGH IMPACT
    │
    │  [API Pagination]   [Test Suite]    [TLS]
    │  [CORS Hardening]
    │
    │  [WS Filtering]     [Multi-Region]  [PWA]
    │  [Docker Limits]    [Systemd]
    │
LOW IMPACT
    └────────────────────────────────────────────
       LOW EFFORT                        HIGH EFFORT
       (S)              (M)              (L–XL)
```

## Phase 3 — Item Summary

| ID | Item | Category | Effort | Impact | Priority | Status |
|----|------|----------|--------|--------|----------|--------|
| H1 | API Pagination & Filtering | Quality | M | High | P1 | Not Started |
| H2 | Backend Test Suite Expansion | Quality | L | High | P1 | Not Started |
| H3 | CORS & Security Hardening | Quality | S | High | P1 | Not Started |
| H4 | WebSocket Per-Client Filtering | Quality | M | Medium | P2 | Not Started |
| I1 | TLS / HTTPS Termination | Infrastructure | S | High | P1 | Not Started |
| I2 | Docker Resource Limits & Restart Policies | Infrastructure | S | Medium | P2 | Not Started |
| I3 | Systemd Unit & Pi 5 Auto-Start | Infrastructure | S | Medium | P2 | Not Started |
| J1 | Multi-Region / Multi-Bbox Monitoring | Capabilities | L | Medium | P2 | Not Started |
| J2 | Mesh Network Routing Visualization | Capabilities | L | Low | P3 | Not Started |
| J3 | Progressive Web App (PWA) | Capabilities | M | Medium | P3 | Not Started |

---

## Suggested Sprint Order — Phase 3

### Sprint 9 — Production Hardening (P1)
`H1` API pagination · `H3` CORS & security hardening · `I1` TLS termination

### Sprint 10 — Test Coverage & WS Scale (P1–P2)
`H2` Backend test suite · `H4` WebSocket per-client filtering

### Sprint 11 — Deployment Tooling (P2)
`I2` Docker resource limits · `I3` Systemd / Pi 5 auto-start · `J1` Multi-region monitoring (partial: config schema + ADS-B)

### Sprint 12 — Expansion (P2–P3)
`J1` Multi-region (remaining pollers) · `J2` Mesh routing visualization · `J3` PWA

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| Not Started | Work not yet begun |
| In Progress | Actively being developed |
| In Review | PR open, awaiting review |
| Done | Merged and deployed |
| Deferred | Intentionally postponed |
| Blocked | Waiting on dependency |
