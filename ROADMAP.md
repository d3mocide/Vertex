# Vertex — Strategic Roadmap

> **Scope:** Forward-looking feature roadmap as of April 2026.
> Historical bug fixes and M1–M6 milestone items are tracked in `FEATURES_AND_ROADMAP.md`.
> All items in that document are complete.

---

## Current Baseline

Vertex is fully operational across all core systems:

| System | Status |
|--------|--------|
| 10 async pollers (ADS-B, AIS, P25, weather, alerts, traffic, utilities, news, meshcore, seismic) | Production |
| FastAPI REST + WebSocket backend (65+ endpoints) | Production |
| React/MapLibre/Deck.gl frontend (10 panels, full map stack) | Production |
| PostgreSQL + PostGIS persistence, Redis pub/sub | Production |
| JWT authentication, rate limiting, Prometheus metrics | Production |
| AI situational summary (LiteLLM, cloud or local) | Production |
| Multi-platform Docker Compose (amd64 / arm64) | Production |

---

## Priority Matrix

Axes: **Impact** (operational value delivered) × **Effort** (engineering cost).
Effort scale: XS < S < M < L < XL.

```
HIGH IMPACT
    │
    │  [Fire/Smoke]     [TAK/CoT]       [Webhooks]
    │  [APRS]           [Offline Tiles] [AI Anomaly]
    │
    │  [SitRep Export]  [Multi-Role Auth] [Circle Geofences]
    │  [Data Retention] [Talkgroup Mgmt]  [Playback Markers]
    │
    │  [Seismic Feed]   [KML Import]    [Test Suite]
    │  [Camera Health]  [Entity Charts] [Grafana]
    │
LOW IMPACT
    └────────────────────────────────────────────────
       LOW EFFORT                          HIGH EFFORT
       (XS–S)          (M)                (L–XL)
```

### Quadrant Summary

| Quadrant | Strategy | Items |
|----------|----------|-------|
| High Impact / Low Effort | **Do first** | Webhooks, Playback Markers, Fire/Smoke, Seismic Feed, Camera Health, Data Retention UI |
| High Impact / High Effort | **Plan carefully** | TAK/CoT, APRS, Offline Tiles, AI Anomaly Detection |
| Low Impact / Low Effort | **Fill-in work** | SitRep Export, Talkgroup Mgmt, Entity Detail Charts, KML Import |
| Low Impact / High Effort | **Defer or descope** | Full Grafana stack, Multi-tenant RBAC |

---

## Roadmap Items

### Category A — New Data Sources

---

#### A1 — Fire / Smoke / Active Incident Overlays

- **Value:** InciWeb (NIFC), USFS Active Fire WMS, and NOAA HMS smoke layers are public and free. Wildfire situational awareness is high-value for a Pacific Northwest field tool.
- **Sources:** InciWeb ATOM feed, NIFC ArcGIS REST, NOAA HMS WMS
- **Implementation:**
  - New `fire.py` poller — fetches active incident GeoJSON from InciWeb/NIFC at 10-min interval
  - Store incidents as `entity_type = "fire_incident"` in existing entity model
  - Frontend: fire marker layer in `buildEntityLayers.ts`, smoke opacity overlay via WMS tile layer in `Map.tsx`
- **Effort:** M
- **Status:** Not Started

---

#### A2 — APRS / HAM Radio Tracking

- **Value:** APRS-IS (Automatic Packet Reporting System) tracks vehicles, weather stations, and amateur operators. Complements ADS-B and AIS. Public TCP feed, no API key required.
- **Sources:** `rotate.aprs2.net:14580` APRS-IS filtered feed
- **Implementation:**
  - New `aprs.py` poller — TCP stream, filter by bounding box (`r/lat/lon/radius`)
  - Normalize to existing Entity model (`entity_type = "aprs"`)
  - Frontend: APRS icon style in `iconAtlas.ts`, callsign label in entity layer
- **Effort:** M
- **Status:** Not Started

---

#### A3 — Seismic Feed (USGS)

- **Value:** USGS earthquake feed is lightweight GeoJSON. Pacific Northwest seismic events frequently precede infrastructure disruptions. Easy integration.
- **Source:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`
- **Implementation:**
  - New `seismic.py` poller — polls at 60s interval, stores as `Event` records (`event_type = "seismic"`)
  - Frontend: seismic event markers in `EventLogPanel.tsx` and map event layer
- **Effort:** S
- **Status:** Done

---

### Category B — New Capabilities

---

#### B1 — Outbound Webhooks / Alerting Rules

- **Value:** Turns Vertex from a passive display into an active alerting system. Operators configure rules ("when entity enters geofence X → POST to Slack/Discord/PagerDuty") without code changes.
- **Implementation:**
  - New `AlertRule` DB model: `trigger_type` (geofence_entry, severity_threshold, entity_type), `filter` (JSON), `action_type` (webhook_post, log), `action_config` (JSON URL + headers)
  - New `webhook_dispatcher.py` worker — subscribes to Redis event bus, evaluates rules, fires HTTP POSTs
  - New backend router `/api/v1/alertrules` — CRUD for rules
  - Frontend: Alert Rules section in Settings panel
- **Effort:** M
- **Status:** Not Started

---

#### B2 — TAK / Cursor-on-Target (CoT) Output

- **Value:** CoT XML is the lingua franca of military/public-safety situational awareness (ATAK, WinTAK, iTAK, TAK Server). Emitting entity positions as CoT connects Vertex to a large existing ecosystem.
- **Protocol:** CoT over UDP multicast (239.2.3.1:6969) or TAK Server TCP
- **Implementation:**
  - New `cot_emitter.py` worker — subscribes to `entity_update` Redis channel, converts Entity + Observation to CoT XML, emits via UDP multicast or configurable TAK Server address
  - Config: `COT_ENABLED`, `COT_MULTICAST_ADDR`, `COT_TAKSERVER_HOST` in `poller/config.py`
  - Entity type mapping: aircraft → `a-f-A`, vessel → `a-f-S`, mesh → `a-f-G`
- **Effort:** L
- **Status:** Not Started

---

#### B3 — AI Anomaly Detection

- **Value:** Extend the existing LiteLLM summary worker to flag anomalous entity behavior: aircraft loitering, vessel AIS gap > threshold, entity entering restricted zone at unusual hours, sudden speed/altitude changes. Configurable sensitivity.
- **Implementation:**
  - Extend `summary.py` poller with an `AnomalyScorer` class
  - Statistical baselines computed from observation history (rolling 7-day window per entity type)
  - Anomalies emitted as `Event` records (`event_type = "anomaly"`, `severity = "high"`)
  - Frontend: anomaly badge on entity icons, anomaly filter in EventLogPanel
- **Effort:** L
- **Status:** Not Started

---

#### B4 — SitRep Export

- **Value:** One-click Markdown or PDF export of a time-windowed situation report: active entities, events triggered, alerts, weather summary, AI narrative. Useful for incident documentation and shift handoff.
- **Implementation:**
  - New backend endpoint `GET /api/v1/sitrep?start=&end=&format=md|pdf`
  - Aggregates: event log query, active alerts from Redis, AI summary, entity counts by type
  - PDF via `weasyprint` or Markdown via Jinja2 template
  - Frontend: "Export SitRep" button in EventLogPanel header
- **Effort:** M
- **Status:** Not Started

---

### Category C — Feature Refinements

---

#### C1 — Playback Controller: Event Markers on Timeline

- **Value:** The scrubber is time-based only. Operators can't jump directly to significant moments. Event markers (geofence triggers, P25 calls, critical alerts) on the timeline bar would make replay operationally useful.
- **File:** `frontend/src/components/panels/PlaybackController.tsx`
- **Implementation:**
  - Backend `/api/v1/observations/replay` already exists; add `?include_events=true` to co-fetch events in the time window
  - Render event markers as colored tick marks on the scrubber rail
  - Click-to-seek to event timestamp
- **Effort:** S
- **Status:** Done

---

#### C2 — Entity Detail Panel: Sparkline Charts

- **Value:** The detail panel shows last-known metadata. Adding a mini speed/altitude chart (aircraft) or speed/course chart (vessel) over the last N observations would surface behavioral context at a glance.
- **File:** `frontend/src/components/panels/EntityDetail.tsx`
- **Implementation:**
  - Fetch recent observations from existing `GET /api/v1/entities/{id}/trail`
  - Render lightweight SVG sparkline (no chart library required — ~40 lines of SVG math)
  - Show last 30 observations, color-coded by altitude band (aircraft) or speed (vessel)
- **Effort:** S
- **Status:** Done

---

#### C3 — Geofence Enhancements: Circles + Dwell Conditions

- **Value:** Circle geofences (center + radius) are more natural for most use cases than polygons. Dwell conditions ("alert only if entity is inside for > N minutes") reduce false-positive noise.
- **Files:** `poller/geofence.py`, `backend/routers/geofences.py`, `frontend/src/components/panels/GeofencePanel.tsx`
- **Implementation:**
  - Add `geofence_shape` (`polygon` | `circle`) and `dwell_seconds` columns to `Geofence` model
  - Circle stored as `ST_Buffer(ST_Point(lon, lat)::geography, radius_m)::geometry`
  - `GeofencePanel.tsx`: add circle draw mode (click center, drag radius)
  - `geofence.py`: track dwell timer per entity per geofence; only emit event after dwell threshold
- **Effort:** M
- **Status:** Not Started

---

#### C4 — P25 Talkgroup Management UI

- **Value:** TGID-to-alias mapping is currently absent. Operators can't identify channels by readable name. A UI for naming talkgroups, setting priority, and building a scan list is essential for field use.
- **File:** `frontend/src/components/panels/TacticalAudio.tsx`, new `backend/routers/talkgroups.py`
- **Implementation:**
  - New `Talkgroup` DB model: `tgid`, `name`, `priority` (1–5), `color`, `scan_enabled`
  - CRUD endpoints at `/api/v1/radio/talkgroups`
  - TacticalAudio panel: inline name editing, priority badge, scan toggle per row
- **Effort:** M
- **Status:** Not Started

---

#### C5 — Camera Health Monitoring

- **Value:** The camera grid shows feeds but has no freshness indicators. Operators may rely on stale/offline feeds without knowing it. Tracking last-successful-image timestamp and flagging dead cameras prevents that.
- **Files:** `frontend/src/components/panels/InfrastructureGrid.tsx`, `poller/pollers/traffic.py`
- **Implementation:**
  - `traffic.py`: HEAD request each camera URL during poll cycle; record `last_ok` timestamp and HTTP status in Redis alongside camera metadata
  - Frontend: green/yellow/red health dot on each camera tile; tooltip shows last-ok time; "Offline" overlay on dead feeds
- **Effort:** S
- **Status:** Done

---

#### C6 — Multi-Role Authentication (Viewer Role)

- **Value:** The `User.role` field exists but is unused — every account is admin. A `viewer` role (read-only, no config changes) enables team deployment without granting everyone write access.
- **Files:** `backend/auth_middleware.py`, `backend/routers/auth.py`, `backend/db/models.py`
- **Implementation:**
  - `auth_middleware.py`: enforce role check on mutating routes (`POST/PUT/PATCH/DELETE`)
  - `auth.py`: `POST /auth/users` endpoint for admin to create viewer accounts
  - Frontend: Settings panel hides config controls when `role === "viewer"`
- **Effort:** S
- **Status:** Done

---

### Category D — Infrastructure & Quality

---

#### D1 — Offline Map Tiles

- **Value:** A Pi deployed in the field may have no internet. Caching map tiles locally (MBTiles format) and falling back to local `tileserver-gl` when the OpenFreeMap CDN is unreachable enables genuine offline operation.
- **Implementation:**
  - Add `tileserver-gl` as an optional Docker Compose service (profile: `offline`)
  - Pre-generate regional MBTiles extract (e.g., Oregon + SW Washington, ~500 MB)
  - `frontend/src/config.ts`: `TILE_URL` env var; Nginx serves local tiles when configured
- **Effort:** L
- **Status:** Not Started

---

#### D2 — Data Retention UI

- **Value:** Observations accumulate continuously. On a Pi SD card, unmanaged growth will silently exhaust disk within months. A settings page showing current storage usage with configurable retention policy prevents this.
- **Files:** `backend/routers/` (new admin router), `frontend/src/components/layout/SettingsPanel.tsx`
- **Implementation:**
  - New `GET /api/v1/admin/storage` endpoint — returns row counts and estimated sizes per table
  - New `POST /api/v1/admin/retention` — sets retention days per entity type (aircraft / vessel / mesh)
  - SettingsPanel: storage gauge + retention sliders (default 30 days, configurable 1–365)
  - `poller/main.py`: daily purge task already runs; make retention period dynamic from DB config
- **Effort:** S
- **Status:** Done

---

#### D3 — KML / GeoJSON Layer Import

- **Value:** Operators frequently have existing overlays — airspace boundaries, restricted zones, county/agency boundaries, infrastructure shapefiles. Importing these as non-geofence display layers removes the need to recreate them manually.
- **Implementation:**
  - New `CustomLayer` DB model: `name`, `geojson` (JSON), `style` (color/opacity JSON), `visible`
  - CRUD endpoints at `/api/v1/layers`
  - Frontend: file drop zone in GeofencePanel (accept `.kml`, `.geojson`, `.json`); renders via MapLibre GeoJSON source
  - KML → GeoJSON conversion via lightweight `toGeoJSON` library (browser-side, no backend dependency)
- **Effort:** M
- **Status:** Not Started

---

#### D4 — Test Suite

- **Value:** Zero tests exist across a complex async codebase. Poller data normalization and geofence detection are the highest-risk areas — subtle bugs here produce silent data corruption or missed alerts.
- **Implementation:**
  - `pytest` + `pytest-asyncio` for backend and poller
  - Priority test targets:
    - `poller/pollers/adsb.py`: entity normalization from raw Ultrafeeder JSON
    - `poller/pollers/ais.py`: vessel normalization from AISstream payload
    - `poller/geofence.py`: entry/exit/dwell state machine
    - `backend/routers/geofences.py`: CRUD + PostGIS validation
  - GitHub Actions CI workflow (`.github/workflows/test.yml`)
- **Effort:** L
- **Status:** Not Started

---

#### D5 — Grafana Dashboard

- **Value:** Prometheus metrics are already exposed at `/metrics`. Adding a Grafana container with pre-built dashboards for poller health, API latency, entity counts, and Redis memory surfaces operational health without building custom UI.
- **Implementation:**
  - Add `grafana` and `prometheus` to Docker Compose under `--profile monitoring`
  - Pre-provisioned datasource (`prometheus.yml`) and dashboard JSON for Vertex-specific panels
  - Default port: Grafana on 3001, Prometheus on 9090
- **Effort:** M
- **Status:** Not Started

---

## Tracking Table

| ID | Item | Category | Effort | Impact | Priority | Status |
|----|------|----------|--------|--------|----------|--------|
| A1 | Fire / Smoke Overlays | New Data Source | M | High | P1 | Not Started |
| A2 | APRS / HAM Tracking | New Data Source | M | High | P1 | Not Started |
| A3 | Seismic Feed (USGS) | New Data Source | S | Medium | P2 | Done |
| B1 | Outbound Webhooks / Alerting Rules | New Capability | M | High | P1 | Not Started |
| B2 | TAK / CoT Output | New Capability | L | High | P2 | Not Started |
| B3 | AI Anomaly Detection | New Capability | L | High | P2 | Not Started |
| B4 | SitRep Export | New Capability | M | Medium | P3 | Not Started |
| C1 | Playback Event Markers | Refinement | S | High | P1 | Done |
| C2 | Entity Detail Sparklines | Refinement | S | Medium | P2 | Done |
| C3 | Geofence Circles + Dwell | Refinement | M | High | P1 | Not Started |
| C4 | P25 Talkgroup Management | Refinement | M | Medium | P2 | Not Started |
| C5 | Camera Health Monitoring | Refinement | S | High | P1 | Done |
| C6 | Multi-Role Auth (Viewer) | Refinement | S | Medium | P2 | Done |
| D1 | Offline Map Tiles | Infrastructure | L | High | P2 | Not Started |
| D2 | Data Retention UI | Infrastructure | S | High | P1 | Done |
| D3 | KML / GeoJSON Import | Infrastructure | M | Medium | P3 | Not Started |
| D4 | Test Suite | Infrastructure | L | Medium | P2 | Not Started |
| D5 | Grafana Dashboard | Infrastructure | M | Medium | P3 | Not Started |

---

## Suggested Sprint Order

### Sprint 1 — Quick Wins (P1 High-Impact / Low-Effort)
Completed: `C1` Playback event markers · `C5` Camera health monitoring · `C6` Multi-role auth · `A3` Seismic feed · `D2` Data retention UI

### Sprint 2 — Core Enhancements (P1 Medium-Effort)
`B1` Outbound webhooks · `C3` Geofence circles + dwell · `A1` Fire/smoke overlays · `A2` APRS tracking

### Sprint 3 — Depth & Refinement (P2)
`C4` Talkgroup management · `B4` SitRep export · `D3` KML import · `D5` Grafana

### Sprint 4 — Strategic Capabilities (P2 High-Effort)
`B2` TAK/CoT output · `B3` AI anomaly detection · `D1` Offline map tiles · `D4` Test suite

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
