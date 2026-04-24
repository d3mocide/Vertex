# Vertex — Features, Gaps, and Roadmap

## Project Overview

Vertex is a local-first, real-time situational awareness dashboard fusing aircraft (ADS-B),
vessel (AIS), weather (NWS/EPA), emergency alerts, traffic (ODOT), P25 trunked radio, and
MeshCore mesh radio into a single map-centric web interface. Runs on a Raspberry Pi 5.
No cloud lock-in, no subscriptions.

---

## P1 — Operational Bugs (breaks production use)

### 1. Unbounded observation growth
- **File:** `db/init/01_schema.sql`, `poller/main.py`
- **Problem:** `purge_old_observations()` is defined in SQL but never called. Observations
  grow indefinitely and will fill the disk on any long-running deployment.
- **Fix:** Schedule the purge as a daily async task in `poller/main.py` using the existing
  asyncpg pool.
- **Status:** Fixed ✓

### 2. Production serving Vite dev server
- **Files:** `docker-compose.yml`, `frontend/Dockerfile`
- **Problem:** The frontend service uses `target: build`, mounts the source tree, and runs
  `npm run dev`. This is a development server exposed as production: no minification, no
  nginx static serving, source maps fully exposed, hot-reload overhead.
- **Fix:** `docker-compose.yml` builds the full multi-stage nginx image. A new
  `docker-compose.dev.yml` override file restores the Vite dev server for local development.
- **Status:** Fixed ✓

### 3. Browser memory leak — vessels and mesh nodes never purged
- **File:** `frontend/src/store.ts`
- **Problem:** `purgeStaleEntities()` only removes aircraft older than 60 seconds. Vessels
  and mesh nodes accumulate in browser memory indefinitely.
- **Fix:** Extended purge to cover vessels (10 min timeout) and mesh nodes (1 hour timeout).
- **Status:** Fixed ✓

### 4. Geofence false-positive storm on poller restart
- **File:** `poller/geofence.py`
- **Problem:** `_entity_state` is an in-process dict that resets on every restart. Every
  tracked entity fires a `geofence_entry` event on startup for every geofence it is already
  inside.
- **Fix:** On first observation for a given entity (not present in `_entity_state`), silently
  initialize state from the PostGIS query result without emitting events.
- **Status:** Fixed ✓

### 5. WebSocket `event` messages silently dropped
- **Files:** `frontend/src/hooks/useWebSocket.ts`, `frontend/src/store.ts`
- **Problem:** The WS message handler has no `case 'event'` branch. Geofence entry/exit and
  P25 call events are published to Redis and forwarded by the backend but silently discarded
  in the browser.
- **Fix:** Added `systemEvents` ring buffer (100-event cap) to the store and dispatched
  `event` type WS messages to it.
- **Status:** Fixed ✓

### 6. Duplicate NWS alert polling
- **Files:** `poller/pollers/weather.py`, `poller/pollers/alerts.py`
- **Problem:** `WeatherPoller._poll_alerts()` fetches NWS alerts for a single zone
  (`nws_zone`) on the same 5-minute cadence. `AlertPoller` already fetches NWS alerts for
  all configured zones (`nws_alert_zones`) every 60 seconds — more coverage, more frequently.
  The two pollers write to overlapping Redis keys.
- **Fix:** Removed `_poll_alerts()` from `WeatherPoller`.
- **Status:** Fixed ✓

---

## P2 — Incomplete UI (scaffolding present, no functionality)

### 7. Mobile navigation (hamburger menu)
- **File:** `frontend/src/components/layout/MobileNav.tsx`, `frontend/src/components/layout/Header.tsx`
- **Problem:** Hamburger button rendered with no `onClick` handler and no slide-out panel.
  The app was unusable on phones.
- **Fix:** Added `MobileNav` full-screen drawer (z-50, left-side slide-in). Driven by
  `mobileNavOpen` in the store. Hamburger `onClick` opens it; Escape key and backdrop tap
  close it. Nav tabs appear vertically with active-state highlighting.
- **Status:** Fixed ✓

### 8. Notifications button
- **File:** `frontend/src/components/layout/Header.tsx`
- **Problem:** Bell icon button rendered, no handler. Intended to surface geofence and alert
  events.
- **Fix:** Bell opens a `NotificationsDropdown` (local state, closes on outside click).
  Renders the `systemEvents` ring buffer in reverse-chronological order with severity
  colouring. A red dot indicator appears when the buffer is non-empty.
- **Status:** Fixed ✓

### 9. Settings panel
- **File:** `frontend/src/components/layout/SettingsPanel.tsx`, `frontend/src/store.ts`
- **Problem:** Gear icon button rendered, no handler.
- **Fix:** Gear opens a `SettingsPanel` right-side drawer (z-50, Escape to close). Exposes:
  radar on/off toggle, radar opacity slider, camera layer toggle, and entity-type visibility
  toggles (aircraft / vessels / mesh nodes) backed by `entityFilter` in the store.
- **Status:** Fixed ✓

### 10. TacticalAudio channel controls
- **File:** `frontend/src/components/panels/TacticalAudio.tsx`
- **Problem:** Skip/prev/next buttons rendered with no `onClick` handlers.
- **Fix:** Added `selectedTgIdx` local state. Skip prev/next cycle through
  `visibleTalkgroups` (wraps around), open the channel list, and highlight the selected row.
  Clicking a row in the channel list also sets the selection. Left info section reflects the
  selected channel name and TGID.
- **Status:** Fixed ✓

---

---

## P2.5 — Shipped After Document Was Written

### 23. Camera map layer controls
- **Files:** `frontend/src/components/panels/CameraModal.tsx`,
  `frontend/src/components/layout/Header.tsx`, `frontend/src/store.ts`
- **What shipped:** A `CameraToggle` button in the header toggles the camera icon layer on
  the map (`camerasVisible` in store). Clicking a camera icon on the map or in the
  Infrastructure grid opens a full-screen `CameraModal` with still-image viewer, LDI/live
  toggle, and favourite management. Backed by `selectedCamId`, `camerasVisible`, and
  `favoriteCamIds` (localStorage) in the store.
- **Status:** Shipped ✓ (commit `7a14640`)

---

## P3 — Missing Features from the M1–M6 Roadmap

### 11. Prometheus metrics endpoint
- **File:** `backend/main.py`, `backend/requirements.txt`, `docker-compose.yml`
- **Roadmap:** M6
- **What shipped:** Added `prometheus-fastapi-instrumentator` to backend requirements.
  `Instrumentator().instrument(app).expose(app)` wires up `/metrics` in `backend/main.py`.
  Ultrafeeder `PROMETHEUS_ENABLE` flipped to `"true"` to expose its native ADS-B metrics.
- **Status:** Fixed ✓

### 12. Authentication / access control
- **Files:** `backend/routers/auth.py`, `backend/auth_middleware.py`, `backend/config.py`,
  `frontend/src/auth.ts`, `frontend/src/components/LoginPage.tsx`, `frontend/src/App.tsx`,
  `frontend/src/hooks/useAlerts.ts`, `frontend/src/hooks/useWebSocket.ts`
- **Roadmap:** M6
- **What shipped:** In-app JWT authentication. Disabled by default (`AUTH_ENABLED=false`).
  When enabled: `POST /api/v1/auth/token` issues a signed JWT (HS256, bcrypt password
  verification). `AuthMiddleware` validates Bearer tokens on all HTTP routes and `?token=`
  query param on WebSocket upgrades. `/health`, `/metrics`, and `/api/v1/auth/*` are always
  public. Frontend fetches `GET /api/v1/auth/status` on load to decide whether to show the
  login page — no rebuild required to toggle auth.
- **Status:** Fixed ✓

### 13. Remote access
- **Roadmap:** M6
- **Note:** No container added. Deploy your own reverse proxy (nginx, Traefik, HAProxy)
  in front of the frontend port and configure TLS termination there. The JWT auth layer
  (item 12) provides the access control regardless of which proxy sits in front.
- **Status:** Deferred — handled by external reverse proxy

### 14. Regional portability
- **Files:** `poller/config.py`, `poller/pollers/alerts.py`, `poller/pollers/traffic.py`, `.env.example`
- **What shipped:** Moved all region-specific hardcoded values to `Settings`:
  `flashalert_url`, `flashalert_enabled`, `tvfr_rss_url`, `tvfr_enabled`,
  `traffic_flow_corridors`. Set any `_enabled` flag to `false` or replace URLs to adapt
  to a non-Portland deployment. Traffic flow corridor filter now reads from a comma-separated
  env var instead of a hardcoded `if "I-5" in hwy` check.
- **Status:** Fixed ✓

### 15. Observation trail completeness
- **File:** `backend/schemas/observation.py`
- **What shipped:** Added `signal_quality: Optional[float]` and `raw_payload: Optional[dict]`
  to `ObservationSchema`. The ORM model already had both columns; only the Pydantic schema
  was missing them.
- **Status:** Fixed ✓

### 16. AI summary worker
- **Files:** `poller/pollers/summary.py`, `poller/main.py`, `backend/routers/summary.py`,
  `backend/main.py`, `poller/requirements.txt`, `poller/config.py`, `.env.example`
- **Roadmap:** M6
- **What shipped:** `AISummaryPoller` runs every 5 minutes. Uses **LiteLLM** so any
  compatible model works — cloud (Anthropic, OpenAI) or fully local/off-grid (Ollama,
  LM Studio). Set `SUMMARY_LLM_MODEL` to enable; leave blank to disable. Model is scoped
  in `.env`:
  - `anthropic/claude-haiku-4-5-20251001` + `SUMMARY_LLM_API_KEY`
  - `ollama/llama3.2` + `SUMMARY_LLM_API_BASE=http://host:11434` (no key)
  Reads active alerts and incidents from Redis, stores 2-3 sentence narrative in
  `feed:summary:latest`. Backend exposes it at `GET /api/v1/summary`.
- **Status:** Fixed ✓

---

## P4 — New Feature Ideas (not in original roadmap)

### 17. In-app event log panel
- **Value:** Geofence entry/exit events and P25 call events are already generated and pushed
  to the frontend via WebSocket (now that P1 fix #5 is in). A panel (e.g., a "Log" tab or
  sidebar drawer) to surface them would provide a live tactical feed without polling.
- **Implementation:** Read from `systemEvents` in the store (already populated). Sort by ts,
  highlight severity-appropriate colors.

### 18. Entity search and filtering
- **Value:** The map shows all aircraft simultaneously. Adding a sidebar search box (filter by
  callsign, ICAO, MMSI) and type/altitude/speed range sliders would make the map usable at
  high traffic counts.
- **Implementation:** Filter applied client-side in the Zustand selector before rendering
  Deck.gl layers.

### 19. Historical track playback
- **Value:** Observations are stored in Postgres with full timestamps. A scrubber/timeline
  control to replay entity positions over the last N hours is a high-value feature with no
  new data collection required.
- **Implementation:** Backend needs a `/api/v1/observations/replay?start=&end=&type=`
  endpoint. Frontend needs a playback controller component and a "replay mode" state flag
  that replaces live entity positions with historical ones.

### 20. Custom geofence creation (UI)
- **Value:** The DB schema and PostGIS geofence engine already support arbitrary polygons.
  Only the creation UI and a CRUD API endpoint are missing.
- **Implementation:** MapLibre draw plugin for polygon creation → `POST /api/v1/geofences`
  → events start firing automatically.

### 21. Browser push notifications
- **Value:** When a high-severity NWS alert arrives or an aircraft enters a geofence, fire a
  browser Notification API alert (even when the tab is in background).
- **Implementation:** Service worker registration + `Notification.requestPermission()` call.
  Trigger from the WebSocket `event` handler (already in place post P1 fix #5).

### 22. Rate limiting on the API
- **File:** `backend/main.py`
- **Value:** Protects the Pi from accidental or intentional DoS.
- **Implementation:** `slowapi` middleware with `RateLimiter` dependency on all routers.
  Reasonable defaults: 60 req/min on REST, unlimited for the WebSocket.

---

## Summary Table

| # | Item | Category | Effort | Status |
|---|------|----------|--------|--------|
| 1 | Purge scheduling | P1 Bug | XS | ✓ Done |
| 2 | Prod docker-compose | P1 Bug | S | ✓ Done |
| 3 | Browser entity leak | P1 Bug | XS | ✓ Done |
| 4 | Geofence cold-start | P1 Bug | XS | ✓ Done |
| 5 | WS event handling | P1 Bug | XS | ✓ Done |
| 6 | Duplicate NWS polling | P1 Bug | XS | ✓ Done |
| 7 | Mobile nav | P2 UI | M | ✓ Done |
| 8 | Notifications UI | P2 UI | S | ✓ Done |
| 9 | Settings panel | P2 UI | M | ✓ Done |
| 10 | Audio channel controls | P2 UI | S | ✓ Done |
| 23 | Camera map layer controls | P2.5 Shipped | M | ✓ Done |
| 11 | Prometheus metrics | P3 Roadmap | S | ✓ Done |
| 12 | Authentication | P3 Roadmap | M | ✓ Done |
| 13 | Remote access | P3 Roadmap | S | Deferred (external proxy) |
| 14 | Regional portability | P3 Roadmap | M | ✓ Done |
| 15 | Trail completeness | P3 Roadmap | XS | ✓ Done |
| 16 | AI summary worker | P3 Roadmap | M | ✓ Done |
| 17 | Event log panel | P4 New | S | — |
| 18 | Entity search/filter | P4 New | M | — |
| 19 | Historical playback | P4 New | L | — |
| 20 | Custom geofence UI | P4 New | L | — |
| 21 | Push notifications | P4 New | M | — |
| 22 | API rate limiting | P4 New | XS | — |
