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
| E1 | Map Annotation Tools | Tactical UX | M | High | P1 | Not Started |
| E2 | P25 Audio Archiving | Tactical UX | L | High | P1 | Not Started |
| E3 | Entity Tagging / Mission Grouping | Tactical UX | S | High | P1 | Done |
| E4 | Alert Suppression / Cooldown Rules | Tactical UX | S | High | P1 | Done |
| E5 | Dashboard Snapshot Export | Tactical UX | S | Medium | P2 | Done |
| F1 | ATAK Bidirectional (CoT Ingest) | Radio/TAK | M | High | P1 | Not Started |
| F2 | Talkgroup Scan Priority Enforcement | Radio/TAK | M | Medium | P2 | Not Started |
| G1 | Scheduled SitRep Delivery | Deployment | S | Medium | P2 | Not Started |
| G2 | Mobile-Responsive Layout | Deployment | L | Medium | P2 | Not Started |
| G3 | Panel Layout Persistence | Deployment | S | Low | P3 | Not Started |

---

## Suggested Sprint Order — Phase 2

### Sprint 5 — Tactical Quick Wins (P1 Low-Effort) ✓ Complete
`E3` Entity tagging · `E4` Alert suppression rules · `E5` Snapshot export

### Sprint 6 — Core Tactical Capabilities (P1 Medium-Effort)
`E1` Map annotations · `F1` ATAK CoT ingest

### Sprint 7 — Depth & Radio (P2)
`E2` P25 audio archiving · `F2` Scan priority enforcement · `G1` Scheduled SitRep

### Sprint 8 — Deployment Hardening (P2–P3)
`G2` Mobile-responsive layout · `G3` Panel layout persistence

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
