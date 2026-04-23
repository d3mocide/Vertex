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
- **File:** `frontend/src/components/layout/Header.tsx`
- **Problem:** Hamburger button renders with `aria-label="Open navigation menu"` but has no
  `onClick` handler and no slide-out panel. The app is unusable on phones.
- **Suggested fix:** Add a slide-out drawer component driven by a `mobileNavOpen` boolean in
  the store. Nav tabs should appear in the drawer on small screens.

### 8. Notifications button
- **File:** `frontend/src/components/layout/Header.tsx`
- **Problem:** Bell icon button renders, no handler. Intended to surface geofence events and
  severe weather alerts.
- **Suggested fix:** Open a dropdown/sheet showing the `systemEvents` ring buffer (now
  populated by the P1 fix above).

### 9. Settings panel
- **File:** `frontend/src/components/layout/Header.tsx`
- **Problem:** Gear icon button renders, no handler. Intended to expose user preferences.
- **Suggested fix:** Add a settings drawer with: default tab, range ring distance, radar
  opacity, visible entity type toggles, camera radius default.

### 10. TacticalAudio channel controls
- **File:** `frontend/src/components/panels/TacticalAudio.tsx`
- **Problem:** Skip/prev/next channel buttons render with no `onClick` handlers. Only
  play/pause and volume work.
- **Suggested fix:** Wire skip/next to cycle through talkgroups from the call history log.

---

## P3 — Missing Features from the M1–M6 Roadmap

### 11. Prometheus metrics endpoint
- **File:** `backend/main.py`
- **Roadmap:** M6
- **Suggested implementation:** Add `prometheus-fastapi-instrumentator` to backend
  requirements. Expose `/metrics`. Add `PROMETHEUS_ENABLE=true` to ultrafeeder env to enable
  its native metrics endpoint.

### 12. Authentication / access control
- **Files:** `backend/main.py`, `docker-compose.yml`
- **Roadmap:** M6
- **Current state:** CORS is `allow_origins=["*"]`. No auth on REST or WebSocket.
- **Suggested implementation:** Caddy reverse proxy with basic auth or OIDC as the outermost
  layer. Keep the internal stack unauthenticated (LAN only).

### 13. Cloudflare Tunnel / remote access
- **File:** `docker-compose.yml`
- **Roadmap:** M6
- **Suggested implementation:** Add an optional `cloudflared` container as a Compose profile
  (`--profile remote`). Requires a Cloudflare account with a free tunnel.

### 14. Regional portability
- **Files:** `poller/pollers/alerts.py`, `poller/pollers/traffic.py`, `.env.example`
- **Problem:** FlashAlert, TVFR, PGE, and ODOT traffic flow routes are all hardcoded to
  the Portland/Oregon metro area. The `.env` supports region config but pollers don't honor it.
- **Suggested fix:** Move all region-specific RSS URLs and route names to `Settings` so they
  can be overridden via env vars.

### 15. Observation trail completeness
- **Files:** `backend/routers/observations.py`, `backend/schemas/observation.py`
- **Problem:** The trail endpoint doesn't expose `signal_quality` or `raw_payload` columns
  even though they exist in the DB.
- **Suggested fix:** Add those fields to `ObservationSchema` and the SQL query.

### 16. AI summary worker
- **Roadmap:** M6
- **Suggested implementation:** A small async worker (add to poller or as its own container)
  that periodically calls the Anthropic API to produce a plain-language incident narrative
  from the current `alerts`, `weather:alerts`, and `events` Redis keys.

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

| # | Item | Category | Effort |
|---|------|----------|--------|
| 1 | Purge scheduling | P1 Bug | XS |
| 2 | Prod docker-compose | P1 Bug | S |
| 3 | Browser entity leak | P1 Bug | XS |
| 4 | Geofence cold-start | P1 Bug | XS |
| 5 | WS event handling | P1 Bug | XS |
| 6 | Duplicate NWS polling | P1 Bug | XS |
| 7 | Mobile nav | P2 UI | M |
| 8 | Notifications UI | P2 UI | S |
| 9 | Settings panel | P2 UI | M |
| 10 | Audio channel controls | P2 UI | S |
| 11 | Prometheus metrics | P3 Roadmap | S |
| 12 | Authentication | P3 Roadmap | M |
| 13 | Remote access | P3 Roadmap | S |
| 14 | Regional portability | P3 Roadmap | M |
| 15 | Trail completeness | P3 Roadmap | XS |
| 16 | AI summary worker | P3 Roadmap | M |
| 17 | Event log panel | P4 New | S |
| 18 | Entity search/filter | P4 New | M |
| 19 | Historical playback | P4 New | L |
| 20 | Custom geofence UI | P4 New | L |
| 21 | Push notifications | P4 New | M |
| 22 | API rate limiting | P4 New | XS |
