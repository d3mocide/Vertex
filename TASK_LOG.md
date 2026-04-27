# Vertex — Agent Task Log

Chronological log of agent-completed work. Most recent entries at the top.
Format: `## YYYY-MM-DD — <summary>` with bullet points for details.

---

## 2026-04-27 — Fixed database schema inconsistencies and container errors

- **Fix Missing Table**: Added the `AlertFeedConfig` model to `backend/db/models.py`, resolving the `UndefinedTableError` in the `poller` container.
- **Sync DB Models**: Synchronized `Geofence` and `User` models with the SQL schema by adding missing `created_at` fields and `server_default` values.
- **Normalize Timestamps**: Added `server_default=func.now()` and `onupdate=func.now()` to all configuration-related models (`RadioStream`, `NewsFeed`, `PollerSource`, `AlertZoneConfig`, `AlertFeedConfig`) to ensure consistency between SQLAlchemy and manual SQL migrations.
- **Resolve AirNow Timeouts**: Fixed `ReadTimeout` errors in the `WeatherPoller` by increasing the timeout to 30s, switching to region-center coordinates, and enabling redirect following.
- **Resolve Startup Race Condition**: Verified that both `backend` and `poller` containers now initialize and ingest data correctly after a clean rebuild.

---

## 2026-04-25 — Resolved console errors and UI warnings

- **Fix Deck.gl Deprecation**: Updated `selection-ring` in `buildEntityLayers.ts` to use `getFillColor` and `getLineColor` instead of the deprecated `getColor`, resolving v9 console warnings.
- **Suppress Map Image Warnings**: Added a `styleimagemissing` listener in `Map.tsx` to provide a transparent fallback for missing style images (`wood-pattern`, `circle-11`), eliminating console spam from OpenFreeMap style.
- **Fix Favicon 404**: Added an inline SVG favicon data-URI to `index.html` to resolve the missing `favicon.ico` error.
- **Stabilize WebSocket Cleanup**: Refactored `useWebSocket.ts` cleanup to nullify event handlers before closing, mitigating "WebSocket is closed before the connection is established" warnings during React HMR/Strict Mode.
- **Precise Replay Positioning**: Adjusted the REPLAY trigger to `top: 28` and `left: 75px` as requested for pixel-perfect alignment.
- **Reposition Replay System**: Swapped the positions of the REPLAY trigger and the Load History panel for a more logical ergonomic flow across the map.
- **Implement Ultra-Defensive Map Guards**: Added top-level guard clauses to `RadarLayer` and `ObservationRingLayer` to immediately bail if the map instance or its API methods are unavailable. Implemented automatic `radarVisible(false)` cleanup on Environment Panel unmount to ensure main-map stability and prevent any background resource leaks or crashes during panel transitions.
- **Synchronize Observational Columns**: Aligned the vertical scale of the Live Radar to match the "Current Conditions" panel, creating a balanced and symmetrical command deck. Darkened the panel background to `onyx-black/95` with a backdrop blur to eliminate map-bleed and maximize data contrast.
- **Slim Air Quality Gauge**: Streamlined the AQI module by reducing typography scale and bar thickness. This more compact design optimizes vertical space within the 2x2 grid while maintaining all critical data points and color indicators.
- **Finalize Environment Layout**: Optimized the 2x2 grid by placing NWS Alerts and Air Quality on the top row, with Current Conditions and the Live Radar on the bottom row. This ensures high-priority environmental and health metrics are prioritized for ocular scanning.
- **Implement Radar Mini-Map**: Integrated a secondary, localized MapLibre instance directly into the Environment Monitor. This "Mini-Radar" provides a persistent weather visualization focused on the user's primary region, complete with grayscale tactical styling and a dynamic scanning sweep animation.
- **Refine Panel Aesthetics**: Removed the persistent gold borders from all `hud-panel` components and internal modules in favor of a cleaner, borderless aesthetic. Replaced high-contrast amber outlines with subtle white edges to enhance the glassmorphism effect and reduce visual noise.
- **Overhaul Environment Monitor**: Upgraded the environmental tracking interface with high-fidelity visual components. Added a gradient-backed multi-segment AQI scale, a new iconography-driven Weather Grid with detailed stats, and enhanced "Hazard Status" modules with integrated health glows and animations.
- **Unified White Branding**: Finalized the sidebar typography by setting the entire "VERTEX" brand name to solid white, paired with the gold "Watchfinder" icon for a high-contrast, professional aesthetic.
- **Watchfinder Brand Identity**: Finalized the sidebar branding with a tactical viewfinder/crosshair icon and a high-contrast typography treatment: "VERTE" in white and "X" in gold. This design emphasizes the project's focus on targeted monitoring and situational awareness.
- **Tactical Watch Branding**: Introduced a new SVG icon blending an eye silhouette with a camera aperture and crosshair accents. This "Tactical Eye" reinforces the project's theme of persistent, modern neighborhood watch situational awareness.
- **Simplify Brand Identity**: Removed the "SYSTEM.OS" tagline and introduced a new diamond-based geometric vertex icon for a cleaner, more minimalist tactical look in the sidebar.
- **Brand Identity Overhaul**: Replaced the plain text sidebar logo with a premium geometric SVG icon and dual-weight typography. The new design includes tactical guidelines and a "SYSTEM.OS" subtitle, reinforcing the project's high-tech situational awareness aesthetic.
- **Target Sidebar News**: Filtered the sidebar news feed to exclusively show "Regional News", ensuring it remains focused on broad situational awareness. Also removed the item count limit to allow full scrollability within the sidebar.
- **Categorize News Feed**: Refactored the backend news poller and frontend community panel to support hierarchical grouping. News is now automatically bucketed into "Tactical Resources", "Local Government" (e.g., City of Tualatin), and "Regional News", ensuring better long-term maintainability and operational clarity.
- **Enable Dev-Mode Volumes**: Added volume mounts to the `backend` and `poller` services in `docker-compose.yml`, allowing host code changes to propagate instantly to running containers.
- **Restructure Community Feed**: Promoted "Tactical Resources" to the top of the `CommunityPanel` and moved the City of Tualatin municipal feed into this persistent section, leaving the "Live Intel Feed" focused on time-sensitive news and alerts.
- **Refine Community Feed**: Segregated static signup links (PublicAlerts, OR-Alert, etc.) into a new "Tactical Resources" section at the bottom of the `CommunityPanel`, ensuring the primary feed is strictly chronological and clutter-free.
- **Expand Camera Grid**: Increased the `PAGE_SIZE` in `InfrastructureGrid.tsx` to 12, adding a 4th row of live traffic feeds to the situational monitor.
- **Cleanup Header UI**: Removed the redundant "CRITICAL ACTIVE" status badge from the header as the ModeToggle already provides clear visual feedback.
- **Zone Monitor Toggle**: Added a new "Zone Monitor" map layer toggle in the Settings panel to control the visibility of Geofences and infrastructure boundaries.
- **Fix Deck.gl Assertion Error**: Resolved `deck.gl: assertion failed` by adding proper cleanup for the `onMapMouseMove` listener and `tooltip` element in `MapOverlay.tsx`, preventing stale listeners from acting on finalized Deck instances.
- **Unified Map Tooltips**: Consolidated all map layer tooltips (Aircraft, Vessels, Cameras, Geofences, and Mesh Nodes) into a single "Interaction Bridge" in `MapOverlay.tsx`. This resolves the interaction conflict where stacked canvases blocked tooltips.
- **Verified Codebase Quality**: Executed the full pre-commit verification suite (TSC typecheck, Docker config validation, and Python syntax check). All checks passed successfully.
- **Fix Sidebar Syntax**: Corrected a JSX tag imbalance in `Sidebar.tsx` that was causing a build failure.
- **Consolidate Grid Status**: Moved Active Incident and Weather Alert counters into the primary status header for a higher-density, more efficient layout.
- **Refine UI Layout**: Renamed the "Safety" tab to "Overview" and moved the "REPLAY" controller to the top-right corner of the map for better ergonomic flow.
- **Analyze Connection Errors**: Identified that "Could not establish connection" errors are likely external (browser extensions) and not app-originated.
- **Sunset UI Toggles**: Removed the redundant "CAMERAS" and "RADAR" toggle buttons from the `Header.tsx` as they are now consolidated into the Settings panel.
- **Unify Environment Variables**: Consolidated redundant variables across frontend, backend, and pollers into a unified URL-based schema (`RADIO_STREAM_URL`, `OP25_URL`, `ICECAST_URL`, `ADSB_URL`).
- **Suppress AI Summary Warnings**: Added a warning filter to suppress "Pydantic serializer warnings" triggered by LiteLLM in the summary poller, cleaning up the logs.
- **Implement Map Tooltips**: Added interactive hover tooltips for aircraft, vessels, traffic cameras, mesh nodes, and geofences. Uses DeckGL `getTooltip` for high-performance icon tooltips and a custom MapLibre overlay for polygon/mesh nodes.
- **Simplify Configuration**: Removed legacy host/port splits in `poller/config.py` and updated pollers to use direct URLs, reducing logic complexity.
- **Streamline Templates**: Overwrote `.env.example` with a clean master template and migrated `.env.remote` to the new schema.
- **Motivation**: Reduce project complexity and eliminate configuration conflicts during development.

## 2026-04-25 — Restored Docker stack and deployed remote configuration

- **Restore Docker Stack**: Created missing `.env` from `.env.example` to resolve container start failures.
- **Deploy Remote Configuration**: Successfully launched the development stack using `docker-compose.dev.yml` and `.env.remote` as requested.
- **Verify Backend Stability**: Confirmed backend container health and successful application startup with the new environment configuration.
- **Sync Pollers**: Forced poller restart to ensure all background tasks are running with the latest `.env.remote` settings.
- **Motivation**: Recover from a broken container state and transition to a remote radio deployment for development.

---

## 2026-04-25 — Synced environment templates and fixed build/runtime errors

- **Sync .env templates** (`.env.local-sdr.example`, `.env.remote.example`): Added missing sections from `.env.example` to the specialized templates (Traffic Flow, Regional Alerts, AI Summary, Auth).
- **Fix Build Failures**:
    - Updated `prometheus-fastapi-instrumentator` to `7.1.0` in `backend/requirements.txt` to resolve a missing version error.
    - Downgraded `httpx` to `0.27.2` in `poller/requirements.txt` to resolve a dependency conflict with `litellm`.
- **Fix Runtime Errors**:
    - Added missing `shapely` dependency to `backend/requirements.txt`.
    - Refactored `backend/db/session.py` to use `Base.metadata.create_all` instead of manual SQL, resolving an `IntegrityError` caused by sequence duplication and a `PostgresSyntaxError` from multi-statement blocks.
- **Motivation**: Ensure specialized deployment profiles have parity with new system features and configuration options, and restore system stability across the Docker environment.

---

## 2026-04-24 — Phase 4: all 6 new features implemented

- **#22 API rate limiting** (`backend/rate_limit.py`, `backend/main.py`): `RateLimitMiddleware` uses Redis sliding-window to enforce 60 req/min per IP on all REST routes; WebSocket upgrades, `/health`, and `/metrics` are exempt.
- **#17 Event log panel** (`frontend/src/store.ts`, `frontend/src/components/panels/EventLogPanel.tsx`, `Header.tsx`, `MobileNav.tsx`, `App.tsx`): Added `'events'` to `NavTab` union; new full-screen panel reads `systemEvents` ring buffer with severity filter, text search, and expandable details rows.
- **#21 Browser push notifications** (`frontend/public/sw.js`, `frontend/src/notifications.ts`, `hooks/useWebSocket.ts`, `layout/SettingsPanel.tsx`): Service worker registered on app load; `maybeNotify()` fires browser `Notification` for critical/high severity events arriving via WebSocket; permission requested via Settings panel toggle.
- **#18 Entity search & filtering** (`frontend/src/store.ts`, `frontend/src/components/panels/EntitySearchPanel.tsx`, `components/MapOverlay.tsx`, `components/layers/MeshLayer.tsx`): Added `entitySearchQuery`, `entityAltRange`, `entitySpeedRange` to store; `EntitySearchPanel` HUD (Safety tab, top-left) provides callsign/ICAO/MMSI search, altitude/speed range sliders, and type toggles; all filters applied inside `MapOverlay` RAF tick loop; `MeshLayer` now respects `entityFilter.mesh_node`.
- **#19 Historical track playback** (`backend/routers/observations.py`, `frontend/src/store.ts`, `frontend/src/components/panels/PlaybackController.tsx`, `components/MapOverlay.tsx`): `GET /api/v1/observations/replay?start=&end=` returns observations grouped by entity; `PlaybackController` HUD (Safety tab, bottom-right) loads a selectable time window (1–24 hr), drives a scrubber at 1–10× speed; `MapOverlay` uses linear interpolation between observation points when `replayMode` is active.
- **#20 Custom geofence creation UI** (`backend/routers/geofences.py`, `backend/main.py`, `frontend/src/store.ts`, `frontend/src/components/layers/GeofenceLayer.tsx`, `frontend/src/components/panels/GeofencePanel.tsx`, `InfrastructureGrid.tsx`, `Map.tsx`): Full CRUD REST router (`GET/POST/PUT/DELETE /api/v1/geofences`) backed by PostGIS; `GeofenceLayer` renders committed zones as semi-transparent dashed polygons and shows live draw preview; `GeofencePanel` (Infrastructure tab) lets operators click the map to place polygon vertices, assign name/zone-type, and save or delete zones.
- **Motivation**: Completed all items in the P4 (new feature ideas) section of `FEATURES_AND_ROADMAP.md`. All features committed to branch `claude/start-phase-4-pbG3X` after passing TS type check, Docker Compose validation, and Python syntax check.

## 2026-04-24 — Agent infrastructure setup

- Created `CLAUDE.md`: comprehensive project orientation for AI agents (architecture, tech stack, key commands, data flow, API surface, failure modes). Eliminates need for codebase discovery on session start.
- Created `Agents.md`: agent behavioral rules, mandatory pre-commit checklist, development workflows per service type, code style conventions, pitfall list.
- Created `TASK_LOG.md`: this file — running log of agent work.
- Created `.claude/commands/typecheck.md`: `/typecheck` skill to run TypeScript type check on frontend.
- Created `.claude/commands/pre-commit-check.md`: `/pre-commit-check` skill to run all validation checks before committing (TS types, Docker config, Python syntax).
- Created `.claude/commands/docker-validate.md`: `/docker-validate` skill to validate Docker Compose YAML.
- Created `.claude/commands/update-task-log.md`: `/update-task-log` skill to append entries to this file.
- **Motivation**: Coding agents were not running type/lint checks before committing, causing Docker frontend builds to fail. Documentation was missing so agents re-ran codebase discovery on every session start.
