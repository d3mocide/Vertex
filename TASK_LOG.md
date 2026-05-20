# Vertex — Agent Task Log

Chronological log of agent-completed work. Most recent entries at the top.
Format: `## YYYY-MM-DD — <summary>` with bullet points for details.

---

## 2026-05-20 — Live Map Render Target Dropouts & Gaps Resolution (Zustand Caching & OpenSky Cadence)

- **Zustand Aircraft Snapshot Caching & Merge Logic**:
  - Refactored `setAircraftSnapshot()` in [store.ts](file:///c:/Projects/Vertex/frontend/src/store.ts) to preserve existing aircraft entities (both local BEAST and OpenSky) that are absent from the incoming snapshot, as long as they are not stale based on their source-specific thresholds. This solves the issue of high-frequency local ADSB targets disappearing or stuttering between transient 5-second snapshot updates.
- **Source-Specific Aircraft Staleness Limit**:
  - Refactored `purgeStaleEntities()` in [store.ts](file:///c:/Projects/Vertex/frontend/src/store.ts) to apply a custom 10-minute (`600_000` ms) threshold specifically for `opensky` aircraft to match their 4-minute polling interval.
  - Kept the standard 2-minute (`120_000` ms) limit for local aircraft and fallback configurations. This completely resolves the OpenSky target populate-clear-repopulate loop.
- **Validation**:
  - Successfully verified the complete frontend typescript compiles with zero errors (`npx tsc --noEmit`).
  - Validated Docker Compose configuration syntax.

## 2026-05-20 — CoT Timestamp Split Refactoring (OpenSky & BEAST Feed Stability)

- **Cursor-on-Target Time Semantics Separation**:
  - Refactored `_build_cot()` inside [cot_emitter.py](file:///c:/Projects/Vertex/poller/pollers/cot_emitter.py) to separate data-point sensor measurements from message validity windows.
  - Set the XML `time` attribute to use the sensor's `last_seen` timestamp (`event_time`), ensuring proper chronological sorting inside WinTAK/ATAK and resolving track jumping/rubberbanding.
  - Anchored XML `start` and `stale` attributes to the emitter execution time (`now` and `now + cot_stale_seconds`), ensuring slower-polling OpenSky targets do not immediately timeout on the TAK map, and high-frequency BEAST targets do not drop due to minor network latency or clock skew.
- **Robust Unit Testing**:
  - Updated `test_build_cot_timestamps` in [test_cot_emitter.py](file:///c:/Projects/Vertex/poller/tests/test_cot_emitter.py) to use `unittest.mock.patch` for mocking system time (`datetime`), verifying precise CoT XML generation without system-clock dependency.
- **Validation**:
  - Verified 100% of python poller/backend tests pass (88/88 passing tests).
  - Verified syntax of modified python scripts with `py_compile`.
  - Verified complete frontend typescript compiles with zero errors via `npx tsc --noEmit`.
  - Validated Docker compose YAML structure.

## 2026-05-19 — Dynamic Bounding Box Filtering for Amtrak Poller

- **Amtrak Spatial Ingestion Refactoring**:
  - Removed the hard-coded Oregon/SW Washington bounding box constraints in `amtrak.py`.
  - Implemented dynamic bounding box validation against all active, enabled regions (`settings.regions` via `load_regions()`) inside the Amtrak `_in_bbox()` check.
  - Generalised poller log reporting from `Oregon/PNW` to `configured region(s)`.
  - Fully resolves coordinate ingestion limits so operators in any custom region (e.g. Northeast Corridor, California, Midwest) can track Amtrak trains seamlessly.
- **Unit Test Coverage**:
  - Created a comprehensive test suite `test_amtrak_normalization.py` covering train normalization, mph-to-knots calculations, direction-to-heading compass maps, and spatial bbox containment checks against multiple simulated active regions.
- **Validation**:
  - Successfully verified all 88 python backend/poller tests pass.
  - Verified syntax of changed modules with `py_compile`.
  - Verified frontend TypeScript type-checking compiling cleanly with zero errors.
  - Validated Docker compose config syntax checker.

## 2026-05-19 — OpenSky Unit Normalization & Mesh Node Staleness Clock Correction

- **Telemetry Unit Normalization**:
  - Implemented automatic metric-to-aviation unit conversions in the OpenSky normalizer (`normalize_opensky` inside [aircraft.py](file:///c:/Projects/Vertex/poller/normalizers/aircraft.py)).
  - Corrected raw meters (`state[7]`) to standard altitude in feet (`meters / 0.3048`).
  - Corrected raw m/s (`state[9]`) to standard ground speed in knots (`m_s / 0.514444`).
  - Corrected raw m/s (`state[11]`) to standard vertical rate in feet per minute (`m_s / 0.3048 * 60`).
  - Added unit conversion test coverage `test_units_normalized` inside [test_adsb_normalization.py](file:///c:/Projects/Vertex/poller/tests/test_adsb_normalization.py).
- **Mesh Node Staleness Clock Alignment**:
  - Corrected a timing domain mismatch in the frontend's MapOverlay rendering loop ([MapOverlay.tsx](file:///c:/Projects/Vertex/frontend/src/components/MapOverlay.tsx)) where page-uptime timestamp (`now` from `performance.now()`) was passed to `buildMeshNodeLayers()`.
  - Replaced it with the correct epoch Unix millisecond timestamp (`nowMs` from `Date.now()`), allowing accurate comparisons with the `last_seen` timestamp parsed from the database. Mesh nodes now correctly fade to gray as stale when they have not checked in for >10 minutes.
- **Validation**:
  - Successfully verified all 84 python backend/poller tests pass.
  - Successfully verified the complete frontend typescript compiles without errors (`npx tsc --noEmit`).
  - Validated Docker compose config syntax checker.

## 2026-05-19 — Cursor-on-Target (CoT) Emitter Optimization & Rubberbanding Resolution

- **Cursor-on-Target Emitter Code Audit & Fixes**:
    - **Resolved Track UID Collisions**: Updated mapping logic in `_build_cot()` to correctly identify normalized target fields using `entity_id` and `id` (resolving a bug where `entity.get('id')` was incorrectly called, producing `VERTEX-unknown` for all targets). Distinct targets now map to unique CoT IDs, completely resolving severe WinTAK/ATAK jumping/rubberbanding.
    - **Eliminated Jitter & Out-of-Order Latency**: Replaced real-time timestamping with sensor-provided `last_seen` timestamps. This allows ATAK to recognize chronologically correct sequences and auto-discard older delayed packets (e.g. OpenSky supplement sweeps) without rubberbanding the track backward.
    - **Corrected Aircraft Altitude & HAE Scaling**: Implemented accurate conversions for aircraft metrics by reading standard `altitude` (in feet) and converting to HAE meters (`float(alt_ft) * 0.3048`) for CoT point datagrams. Non-aircraft sources fallback correctly to `altitude_m` or metric values.
    - **Corrected Velocity & Speed Scaling**: Implemented knots-to-meters/second speed conversion (`float(speed_kts) * 0.514444`) for aircraft and vessel entities to comply with the standard `track.speed` metric.
    - **Unit Test Coverage**: Added comprehensive test cases in [test_cot_emitter.py](file:///c:/Projects/Vertex/poller/tests/test_cot_emitter.py) verifying UID resolution, altitude scaling, speed conversions, and timestamping calculations.

## 2026-05-17 — Split-Scroll Layout Refactoring & Padding Fixes

- **Global Filter & Icon System Overhaul**:
    - **Interactive Toggles & Active Indicators**: Redesigned all 11 quick-filter buttons inside [Sidebar.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/layout/Sidebar.tsx) (in both collapsed and expanded sidebar views) to **toggle** their respective map layers on and off independently, preserving the states of other active layers (exactly like settings panel checkboxes). Added gorgeous active-state styling: buttons are at full `opacity-100` when the corresponding map layer is enabled, and transition to a subtle `opacity-40` when toggled off.
    - **Interactive 2-Column Grid**: Upgraded the static multi-row entity count spans in the expanded sidebar ([Sidebar.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/layout/Sidebar.tsx)) into a premium, interactive **2-column grid of buttons** (with Cameras spanning the bottom row).
    - **Surfaced Train Layer**: Integrated the missing **Trains** data feed (`directions_railway` icon) into both the collapsed sidebar count list and the expanded 2-column interactive grid, adding full-fidelity train count tracking.
    - **TinyGS Station Icon Fix**: Replaced the confusing deprecated `'satellite'` icon (which rendered as a photo/landscape frame) with a clean, high-fidelity dish antenna icon (`'settings_input_antenna'`) in the search panel, detail card, and sidebar.
    - **Unified Vessel, Mesh & Gauge Icons**: Standardized all Vessel icons to `'sailing'`, Mesh node icons to `'hub'`, and Stream Gauge icons to `'waves'` across all components ([Sidebar.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/layout/Sidebar.tsx), [SettingsPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/layout/SettingsPanel.tsx), [CommsPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/CommsPanel.tsx), [MeshFleetPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/MeshFleetPanel.tsx), and [EntitySearchPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/EntitySearchPanel.tsx)).
- **Tabbed Activity & Operation Center (Right Panel Overhaul)**:
    - Designed and implemented a tactical, high-fidelity horizontal **Tab Switcher** for the Comms Page's Right Panel to house **Mesh Chat**, **Mesh Fleet**, and **P25 Radio Log** as independent full-height workspaces.
    - Repositioned the **Recent P25 Activity log** from the Left Panel into its own dedicated **P25 Radio Log tab** on the right, expanding the telemetry capacity from 8 to **30 events** for a rich command-history feed.
    - Overhauled layout scaling so that active workspaces (like Mesh Chat's scroll feed and Mesh Fleet's 2-column grid of 101 nodes) dynamically stretch to occupy the complete available viewport height, eliminating outer scrolling.
    - **Overlay Clearance Polish**: Stretched the right panel outer cards completely to the bottom margin by keeping the outer padding small (`lg:pb-6`), and beautifully added offset paddings (`pb-24 lg:pb-28`) directly inside the scrollable message feeds, nodes lists, and radio log viewports. Content scrolls completely past the Tactical Audio bar without any visual gaps at the bottom of the dashboard layout.
- **Safety Tab Controller Bar Realignment**:
    - Relocated the absolute-positioned map controller buttons (`PlaybackController`, `GeofenceController`, `AnnotationController`) to the right (`lg:left-[352px]` instead of `lg:left-[280px]`) on the Safety Tab.
    - **Result**: Establishes a perfect symmetrical `16px` padding gap between the right border of the `EntitySearchPanel` and the left border of the controllers, ensuring 100% visibility of the `REPLAY`, `ZONES`, and `ANNOTATE` actions with no UI occlusion or dropdown conflict.
- **OP25 & APRS Spectral Health Monitors**:
    - Standardized all cards in the **Spectral Health** dashboard to share the identical premium dark card layout (`border-white/10 bg-white/5` with smooth `hover:bg-white/10` transition states), successfully replacing the high-contrast gold highlight style on the **Local Station** card to achieve cohesive visual integration.
    - Updated all card header icons (**OP25 Trunked Link**, **APRS Gateway**, **Mesh Monitor**, and **P2P Link**) to consistently use `text-amber-gold` to solidify a cohesive branding and tactical interface aesthetic.
    - Integrated first-class **OP25 Trunked Link** and **APRS Gateway** monitors into the [SpectralMonitor](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/CommsPanel.tsx) section.
    - Designed a dynamic **OP25 Receiver Link card** that monitors live WebSocket state updates (`radio` store state). When active, it displays:
        - Connection status with pulse animations and glow indicators.
        - The exact active tuning frequency in MHz (e.g. `852.1250 MHz`).
        - The current decrypter/decoder state: Scanning, Encrypted, or Active Call (displaying the specific `TGID` and channel `tag` under transmission).
        - Active scan priority levels.
    - Designed an **APRS Gateway card** that scans the entity database to detect online RF IGate/tracker stations. It displays:
        - Gateway state (Active Rx vs Standby based on recent packet decodes in the last 12 hours).
        - Total decoded station count.
        - The callsign and formatted age (`formatAge`) of the most recently heard station.
- **2-Column Tactical Card Grid Layout, Filters & Sorting Toolbar**:
    - Refactored [MeshFleetPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/MeshFleetPanel.tsx) to replace the plain single-column table layout with a modern, high-density, **2-column grid layout** (`grid grid-cols-1 md:grid-cols-2 gap-2.5`).
    - Implemented a premium, responsive **tactical filter and sorting toolbar** at the top of the panel:
        - **Type Filters**: Toggle between **All**, **Repeaters**, **Clients**, and **Rooms** to isolate specific categories of mesh hardware or destinations instantly. Restructures pagination and resets view to page 1 on switch.
        - **Sort Options**: Switch between **Last Heard** (Default; dynamic check-in sequence) and **Nearest** (proximity search relative to configured operations center).
    - Designed highly resilient **Filtered Empty States** (`filter_list_off` icon with styled placeholder container) that keep the control toolbar visible when no nodes match active filters, avoiding dead-ends and allowing easy fallback to unfiltered lists.
    - Designed sleek, instrumentation-style node cards featuring color-coded battery percentages, dynamic battery state icons (using Google Material Symbols), live connection status indicators, and contact type tags.
    - Sourced and surfaced the calculated geo-distance data (`explore` distance in KM) next to each node, adding a highly valuable spatial awareness metric to the panel.
    - Updated `PAGE_SIZE` to `16` to guarantee a perfectly balanced double-row grid under all pagination states.
- **Mesh Nodes Stale-Purging Fix**:
    - Identified a client-side purging bug where `purgeStaleEntities` in [store.ts](file:///home/zbrain/Projects/Vertex/frontend/src/store.ts) was aggressively purging mesh nodes seen more than 1 hour ago (`STALE_MS.mesh_node = 3_600_000`).
    - This mismatch caused the list of 101 mesh nodes (some seen up to 125 hours ago, representing semi-permanent infrastructure) to load on initial WebSocket connection snapshot and then snap back/disappear 10 seconds later, leaving only 12 active nodes and hiding the pagination footer.
    - Fixed by increasing `STALE_MS.mesh_node` from 1 hour to 7 days (`604_800_000` ms) to align with the backend's persistent nature for mesh infrastructure, ensuring the entire fleet of 101 nodes and the page layout remain persistent and stable.
- **UI Layout & Density**:
    - Relocated [MeshFleetPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/MeshFleetPanel.tsx) (the Mesh Nodes panel) from the Left Column tabbed interface to the Right Column directly below the Network Messaging chat interface in [CommsPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/CommsPanel.tsx).
    - Refactored the Left Column to solely focus on Spectral Health, eliminating the tabs, simplifying the header actions, and removing the unused `healthTab` state.
    - Updated the Right Column to have a smooth scroll wrapper (`lg:overflow-y-auto custom-scrollbar`) on desktop with a height of `lg:h-full` and padding-bottom `pb-28 lg:pb-36` to ensure both the chat interface and the Mesh Network Nodes list are visible, perfectly scrollable, and clear the [TacticalAudio](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/TacticalAudio.tsx) player bar.
    - Fixed the Chat container's height to a stable `h-[450px] lg:h-[500px]` to maintain independent messaging scrolls inside the larger scrolling pane.
    - Refactored [CommsPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/CommsPanel.tsx) to use the split-scrolling pane architecture inspired by the Flight Log dashboard.
    - Set the Left Column (RF & Signal monitors) to be independently scrollable on desktop (`lg:overflow-y-auto lg:h-full`) with a fixed width of `420px`.
    - Made the Right Column (Mesh Chat Box) dynamically expand to fill the full viewport height (`flex-1 lg:h-full`) and set a responsive `min-h-[450px]` on mobile to prevent collapsing.
    - Eliminated the nested scrollbar UX anti-pattern on desktop by removing the hardcoded `800px` height restriction on the chat container.
    - Applied the `pb-28 lg:pb-36` bottom padding standard to both columns to ensure content clears the absolute-positioned [TacticalAudio](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/TacticalAudio.tsx) playbar.
    - Increased bottom scroll padding on the Selected Aircraft Info Panel in [FlightLogPanel.tsx](file:///home/zbrain/Projects/Vertex/frontend/src/components/panels/FlightLogPanel.tsx) (`pb-28 lg:pb-36` instead of `pb-24`) to ensure bottom-most contents (such as ACARS messages) remain fully readable and unobstructed by the playbar.

## 2026-05-16 — Tactical Dashboard Unification & Fire Perimeter Reliability

- **UI Layout & Density**:
    - Expanded `EntityDetail` and `EntitySearchPanel` to `w-80` (320px) to accommodate long incident names and detailed metadata.
    - Refactored `Sparkline` component to use a responsive SVG `viewBox` for fluid rendering in expanded panels.
- **Iconography & Synchronization**:
    - Standardized Material Symbols across Search, Detail, and Map Tooltip panels (Stream Gauges: `waves`, Mesh: `hub`, APRS: `sensors`, Maritime: `sailing`).
    - Unified header background colors in `EntityDetail` to match Map Layer tints for better cross-panel recognition.
- **Data Layer Reliability**:
    - Fixed Fire Perimeter layer loading by implementing an **Aggressive Hybrid Sync** (broad spatial search + targeted name search).
    - Switched NIFC source to the **Year-To-Date** ArcGIS service for improved reliability.
    - Increased perimeter visibility with 35% fill opacity and a 2.5px glowing border.
    - Resolved `NameError` in GTFS-RT poller (`feed_name` vs `feed.name`) and fixed `get_bus` import issues in NIFC poller.
- **Validation**:
    - Poller logs confirm `14 perimeters synced` using the new hybrid logic.
    - `cd frontend && npx tsc --noEmit` ✓


## 2026-05-15 — Self-hosted fallback sprites for MapLibre missing style images

- Added local sprite assets:
    - [frontend/public/sprites/circle-11.png](frontend/public/sprites/circle-11.png)
    - [frontend/public/sprites/wood-pattern.png](frontend/public/sprites/wood-pattern.png)
- Updated [frontend/src/components/Map.tsx](frontend/src/components/Map.tsx) to prefer loading these self-hosted sprite files for known missing IDs before falling back to generated in-memory images.
- Kept transparent fallback behavior for unknown missing IDs.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Reduced `circle-11` map sprite warnings via early fallback registration

- Updated [frontend/src/components/Map.tsx](frontend/src/components/Map.tsx) to pre-register known fallback sprite IDs (`circle-11`, `wood-pattern`) on `styledata` and `load`.
- Kept `styleimagemissing` as a safety net for unknown IDs.
- This prevents style layers from hitting most missing-image warning paths in the first place.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Fixed dev console MIME error from service worker registration

- Root cause: [frontend/src/notifications.ts](frontend/src/notifications.ts) attempted to register `/sw.js` in development where that URL can resolve to HTML, triggering unsupported MIME type errors.
- Updated notification initialization to register the service worker only in production (`import.meta.env.PROD`) and secure contexts.
- This removes the `unsupported MIME type ('text/html')` noise in dev while preserving production notification behavior.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Tuned wood-pattern fallback to subtle green park tint

- Updated [frontend/src/components/Map.tsx](frontend/src/components/Map.tsx) `wood-pattern` fallback from transparent to a low-alpha mottled green texture.
- Goal: preserve park/wood context from style `fill-pattern` usage without the prior high-contrast striped artifact.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Replaced noisy missing map sprite IDs with deterministic fallbacks

- Updated [frontend/src/components/Map.tsx](frontend/src/components/Map.tsx) `styleimagemissing` handling:
    - added explicit generated fallback images for `circle-11` and `wood-pattern`,
    - added one-time warning behavior for unknown missing IDs,
    - retained transparent 1x1 fallback for unknown sprite IDs.
- This removes repeated noisy warnings for known style IDs while preserving map render stability.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Disabled rail dead-reckoning to stop Amtrak drift

- Root cause: rail tracks were still passed through PVB dead-reckoning, so missing/coarse heading values could extrapolate trains north/upward between real reports.
- Updated [frontend/src/components/MapOverlay.tsx](frontend/src/components/MapOverlay.tsx) to bypass PVB for `rail` tracks while keeping replay behavior unchanged.
- Train movement now updates only from real feed positions (plus rail snapping), preventing self-motion drift.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Optimized train map-matching to remove render-loop lag

- Root cause: train snap-to-rail nearest-segment search was running in the animation tick, causing frame-time spikes.
- Updated [frontend/src/components/MapOverlay.tsx](frontend/src/components/MapOverlay.tsx) to:
    - apply rail snapping on raw train reports before PVB,
    - cache per-train snap results keyed by raw report (`lastSeen`, `lon`, `lat`),
    - reuse cached snapped coordinates across animation frames,
    - prune cache entries when tracks are purged.
- Removed per-frame full rail re-snap pass.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Added bounded rail map-matching for train icon rendering

- Implemented client-side rail snapping utility in [frontend/src/layers/railSnap.ts](frontend/src/layers/railSnap.ts) to:
    - parse rail GeoJSON into line segments,
    - compute nearest point on rail segments,
    - snap only when within a max distance threshold.
- Updated [frontend/src/components/MapOverlay.tsx](frontend/src/components/MapOverlay.tsx) to:
    - fetch and cache rail segments from `/rail/tracks`,
    - apply bounded snapping to `rail` tracks before entity layers render,
    - keep raw tracks/trails unchanged (visual icon alignment only).
- Snapping threshold set to `1500 m`; trains outside threshold keep raw positions.
- Validation:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-15 — Added startup diagnostics Make target for backend/frontend health triage

- Added `startup-diagnose` target to `Makefile` to quickly triage startup failures by printing:
    - `docker compose ps`
    - backend/frontend container health inspect output
    - recent backend/frontend/db/redis logs
- Updated `.PHONY` to include `startup-diagnose`.
- Attempted local validation with `make help` and `make startup-diagnose`, but host environment currently lacks a `make` binary (`CommandNotFoundException`).
- The target definition is present and ready to use once `make` is installed or run from an environment that provides GNU Make.

## 2026-05-15 — Fixed intermittent backend unhealthy startup on compose up

- Investigated compose startup failure where `vertex-backend-1` was marked unhealthy and frontend remained `Created` due to dependency gating.
- Confirmed contributing factors:
    - backend healthcheck window was too tight for occasional slow startup/recovery sequences,
    - existing DB volumes could miss `mesh_messages.channel_name`, causing repeated runtime DB errors.
- Updated `docker-compose.yml` backend healthcheck to reduce false negatives during cold starts/recovery:
    - `retries` increased from `3` to `8`
    - added `start_period: 45s`
- Added startup compatibility migration in `backend/db/session.py`:
    - `ALTER TABLE mesh_messages ADD COLUMN IF NOT EXISTS channel_name VARCHAR(128)`
- Validation:
    - `docker compose config --quiet` ✓
    - `python -m py_compile backend/db/session.py` ✓
    - `docker compose up -d backend frontend` ✓
    - backend health inspect: `status=healthy`, `FailingStreak=0` ✓
    - backend logs show successful startup and 200 health checks ✓

## 2026-05-15 — Reworked Comms network node ordering and mesh channel naming

- Updated network node panel sorting to deterministic proximity ordering (nearest to configured center target first, with stable fallbacks).
- Rebranded Comms health tab label from Fleet to Network and updated related empty-state language to match observed-node semantics.
- Enhanced MeshCore ingest to capture channel display names from RemoteTerm message payloads and `/api/channels` metadata when available.
- Added optional `channel_name` support end-to-end:
    - poller message normalization now includes `channel_name`,
    - poller persistence/upsert writes `channel_name` when schema supports it,
    - backend mesh messages API now returns `channel_name`.
- Added schema support for `channel_name` in `db/init/08_mesh_messages.sql` and backend runtime column self-heal via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- Added backward-compatible poller DB write fallback for older volumes that do not yet have the `channel_name` column.
- Updated frontend Comms message filtering and conversation chips/group headers to prefer friendly channel names over raw hashed conversation keys.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose config --quiet` ✓
    - `python -m py_compile poller/pollers/meshcore.py backend/routers/mesh.py` ✓

## 2026-05-14 — Fixed summary poller slice error on fire feed

- Root cause: `poller/pollers/summary.py` treated `feed:fire:perimeters` as a list and sliced it (`fires[:10]`), but NIFC poller stores this feed as GeoJSON FeatureCollection object (`{"type": "FeatureCollection", "features": [...]}`).
- Symptom in poller logs: `[summary] poll error: slice(None, 10, None)` during background refresh.
- Fix: Updated the summary fire section to read `payload["features"]` when payload is a dict, then build lines from `feature.properties` (`name`, `state`, `acres`) with safe fallbacks.
- Validation:
    - `python -m py_compile poller/pollers/summary.py` ✓
    - `docker compose up -d --build poller` ✓

## 2026-05-14 — Fixed live radio stream playback via proxy endpoint

- Root cause: TacticalAudio component was attempting to play external stream URLs directly (e.g., `http://192.168.10.20:8000/op25`). Browsers cannot reach private network IPs, and direct playback fails due to CORS and network isolation.
- Solution: Created backend stream proxy endpoint `/api/v1/radio/proxy/{stream_id}` that:
    - Fetches the external stream URL server-side via `httpx.AsyncClient`
    - Proxies the audio stream back to the browser as `StreamingResponse`
    - Handles connection errors gracefully (503 Service Unavailable).
- Updated `frontend/src/components/panels/TacticalAudio.tsx` to use proxy endpoint instead of raw stream URL: `activeStreamUrl = selectedStream?.id ? ${API_BASE}/radio/proxy/${selectedStream.id} : ''`.
- Added `/api/v1/radio/proxy` to `_PUBLIC_PREFIXES` in `backend/auth_middleware.py` so stream proxy bypasses auth (audio streams are not sensitive data).
- Changes:
    - `backend/routers/radio.py`: Added httpx and StreamingResponse imports; added `proxy_stream(stream_id)` endpoint.
    - `backend/auth_middleware.py`: Whitelisted `/api/v1/radio/proxy` in public prefixes.
    - `frontend/src/components/panels/TacticalAudio.tsx`: Changed `activeStreamUrl` construction to use proxy endpoint; removed unused `STREAM_URL` import.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose config --quiet` ✓
    - `python -m py_compile backend/routers/radio.py backend/auth_middleware.py` ✓
    - `docker compose up -d --build backend frontend` ✓
    - All services healthy (db, redis, backend, poller, frontend, transcription).

## 2026-05-14 — Fixed missing P25 transcripts and recording playback 401s

- Root cause for missing transcripts: transcription watcher scanned only top-level `/data/audio`, but recorder writes nested paths `/data/audio/YYYY-MM-DD/<tgid>/<call_id>.mp3`.
- Updated `transcription/main.py` watch loop to recurse with `rglob("*")` and process nested audio files.
- Root cause for console 401 errors on recording playback: browser media requests were not reliably carrying auth, so direct `/file` URL playback still hit middleware.
- Updated `frontend/src/components/panels/ChannelsPanel.tsx` to fetch recordings with `authHeaders()` and play them from a blob URL instead of a direct protected media URL.
- Kept `backend/auth_middleware.py` query-token fallback for safe recording-file reads as a compatibility path.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose config --quiet` ✓
    - `python -m py_compile backend/auth_middleware.py transcription/main.py` ✓
    - `docker compose up -d --build backend frontend transcription` ✓
    - Transcription logs show backfill processing and DB now includes non-null `p25_recordings.transcription` rows.
    - Backend logs no longer show 401s for `/api/v1/radio/recordings/*/file`.

## 2026-05-13 — Stabilized geofence state-transition tests under query throttling

- Fixed flaky/failing geofence unit tests caused by shared module throttle state between tests.
- Updated [poller/tests/test_geofence.py](poller/tests/test_geofence.py) test lifecycle hooks to:
    - clear `gf._last_geofence_check` in setup,
    - set `gf._GEOFENCE_CHECK_INTERVAL = 0.0` during each test,
    - restore the original interval in teardown.
- This keeps tests focused on entry/exit/dwell transition behavior instead of rate-limit timing.
- Validation:
    - `python -m pytest -q tests/test_geofence.py -q` -> `7 passed`
    - `python -m pytest -q tests -q` -> `79 passed, 18 skipped`

## 2026-05-13 — Fixed advisory banner background rendering on Overview tab

- Diagnosed z-index layering issue: the Map layer (`fixed inset-0 z-0`) at full opacity on the Overview tab was visually obscuring the AlertStatusBar.
- Added `relative z-20` positioning to `AlertStatusBar` component to ensure it renders above the Map layer (z-0) while remaining below modals (z-50+).
- Updated `frontend/src/components/layout/AlertStatusBar.tsx`.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose config --quiet` ✓
    - Python syntax check on staged files ✓

## 2026-05-11 — Added per-source polling controls to Admin Debug probes

- Updated `frontend/src/admin/AdminDebug.tsx` to support per-source recurring diagnostics polling.
- Added source-specific polling state keyed by source id/url:
    - polling enable/disable toggle per selected source,
    - polling interval selection per selected source (15s/30s/60s/120s),
    - independent run-state, error, and latest probe result storage per source.
- Implemented background polling timers that execute the existing `POST /api/v1/admin/debug/remote-feeds/probe` call on each enabled source interval.
- Added in-flight request guards to prevent overlapping probe requests for the same source.
- Kept manual probe execution intact; selected-source UI now reflects source-specific running/polling/error state.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓

## 2026-05-11 — Expanded Admin Debug probes to all remote source types

- Extended `backend/routers/admin_debug.py` with a generalized diagnostics endpoint: `POST /api/v1/admin/debug/remote-feeds/probe`.
- Added source-type-specific on-demand probe handlers for `adsb`, `ais`, `p25`, `meshcore`, `fire`, and `aprs`:
    - ADS-B: HTTP fetch + payload shape check for `aircraft` list.
    - AIS: websocket connection/event capture over configurable probe window.
    - P25: HTTP POST update-command probe and response-shape summary.
    - MeshCore: REST endpoint checks, websocket event counters, and persisted `mesh_messages` storage stats.
    - Fire: HTTP fetch + `events` payload check.
    - APRS: TCP connect/login-banner diagnostic check.
- Preserved backward compatibility by keeping `POST /api/v1/admin/debug/meshcore/probe` and delegating to the new generic probe path.
- Updated `GET /api/v1/admin/debug/remote-feeds` response usage for generalized source selection.
- Updated `frontend/src/admin/AdminDebug.tsx` to:
    - enumerate all supported enabled remote sources,
    - run probes via the new generic endpoint,
    - render generalized check rows (name/protocol/status/latency/summary),
    - conditionally render websocket and storage sections when provided by the selected source type.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose config --quiet` ✓
    - `c:/Projects/Vertex/.venv/Scripts/python.exe -m py_compile backend/routers/admin_debug.py` ✓

## 2026-05-11 — Documented poller distance/BBOX filtering and clarified METAR empty-state messaging

- Investigated the METAR/TAF "No nearby airports" behavior end-to-end and confirmed aviation observations are filtered by configured region BBOX, not by nearest-airport distance.
- Verified active deployment bounds in `.env` and `config/sources.yml`; current configured region includes Portland metro bounds, so an empty list is not explained by PDX being outside configured geographic scope.
- Updated `frontend/src/components/panels/environment/MetarCard.tsx` empty-state copy from "No nearby airports" to "No airports in configured region bounds" to better reflect actual filtering semantics.
- Hardened `poller/pollers/weather.py` aviation polling path: when aviation fetch tasks fail, the poller now logs explicit warnings and publishes empty `weather:aviation_obs` / `weather:aviation_hazards` payloads instead of leaving Redis keys absent.
- Added `docs/configuration/poller-filtering.md` with a per-poller matrix covering BBOX, distance/radius, zone, corridor, and age/relevance gating across sources.
- Updated `docs/README.md` to include the new poller-filtering reference page.
- Corrected `docs/configuration/sources.md` to reflect current multi-region behavior: `regions` in `sources.yml` is supported/preferred, with `.env` `BBOX_*` as fallback.

## 2026-05-11 — Fixed MeshCore public-feed reliability and message surfacing

- Root-cause analysis found two primary issues:
    - MeshCore ingest assumed a rigid RemoteTerm message schema; missing `id` or `conversation_key` caused DB write failures and blocked real-time publish in the same code path.
    - Frontend mesh history hydration replaced store state, allowing reconnect-time race conditions to overwrite newly arrived live WebSocket messages.
- Updated `poller/pollers/meshcore.py`:
    - Added robust message normalization (`_normalize_mesh_message`) with alias/fallback support for evolving RemoteTerm payload keys.
    - Added synthetic stable message IDs when upstream IDs are absent.
    - Added safe defaults for `conversation_key`, `sender_name`, and timestamps.
    - Decoupled persistence from pub/sub broadcast so DB insert failures no longer prevent live `mesh_message` events from reaching clients.
    - Expanded `ON CONFLICT` update to refresh all message fields, not only `acked`.
- Updated `frontend/src/store.ts`:
    - Added deduplicating merge logic for mesh messages and changed `setMeshMessages` to merge instead of replace.
    - Raised mesh message retention ring from 100 to 300 entries for better operator context.
- Updated `frontend/src/hooks/useMeshHistory.ts` to stop reversing/replacing history payload and rely on store merge ordering.
- Updated `frontend/src/components/panels/CommsPanel.tsx` to be null-safe in filtering/rendering and show conversation-key metadata per message for better feed context.
- Updated `frontend/src/notifications.ts` to avoid runtime exceptions when sender name/message body are missing.
- Validation:
    - `python -m py_compile poller/pollers/meshcore.py` passed.
    - `cd frontend && npm install && npx tsc --noEmit` passed with zero errors.
    - Runtime check: poller remained healthy; MeshCore websocket reconnected after transient timeout and reported `connected=True`.

## 2026-05-11 — Added Admin Debug section with on-demand remote feed diagnostics

- Added backend debug router `backend/routers/admin_debug.py` and registered it in `backend/main.py`.
- New endpoint `GET /api/v1/admin/debug/remote-feeds` lists enabled remote sources (including meshcore) with credential-safe URLs.
- New endpoint `POST /api/v1/admin/debug/meshcore/probe` performs an on-demand probe for a selected MeshCore source:
    - REST checks for `/api/health`, `/api/contacts`, `/api/neighbors` with latency and status reporting.
    - WebSocket probe (`/api/ws`) with event-type counters over a configurable time window.
    - Correlates with persisted `mesh_messages` DB stats (total, last hour, latest timestamp).
    - Returns operator-facing recommendations for common silent-failure patterns.
- Added `frontend/src/admin/AdminDebug.tsx` as a new admin panel for running probes on demand and rendering results.
- Updated `frontend/src/AdminApp.tsx` navigation to include a new `Debug` section (`bug_report` icon).

## 2026-05-10 — Fixed Mesh RemoteTerm messages 500 and reduced health-log spam

- Root cause for frontend console 500 on GET /api/v1/mesh/messages was a missing mesh_messages table in an existing database volume (new installs had db/init/08_mesh_messages.sql, but existing volumes were not auto-migrated).
- Updated backend endpoint resilience in backend/routers/mesh.py:
    - Added missing-table detection for mesh_messages query failures.
    - Added one-time self-heal DDL path to create mesh_messages table/indexes and retry query.
    - Endpoint now returns 200 with data (or [] on unrecoverable self-heal failure) instead of surfacing 500 for this migration gap.
- Reduced MeshCore poller log noise in poller/pollers/meshcore.py:
    - Moved full raw health payload dump from INFO to DEBUG.
    - Replaced per-minute "radio connected" spam with throttled health summary INFO logs (state change or every 5 minutes).
    - Summary includes key operator metrics (connected, battery_mv, rssi, snr, queue, errors, uptime).
- Validation:
    - python -m py_compile backend/routers/mesh.py poller/pollers/meshcore.py
    - docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d backend poller
    - docker compose logs shows one-time backend self-heal warning followed by GET /api/v1/mesh/messages 200 OK
    - poller logs now show health summary instead of repeated full raw payload spam

## 2026-05-09 — Sprint 12: J1 Multi-Region (remaining) + J2 Mesh Link Visualization + J3 PWA

### J1 — Multi-Region Monitoring (remaining: DB migration + AIS poller)
- **`db/init/06_region_id.sql`**: `ALTER TABLE entities ADD COLUMN IF NOT EXISTS region_id VARCHAR(64)` with index; safe to apply on existing DB.
- **`backend/db/models.py`**: Added `region_id: Mapped[Optional[str]]` column to `Entity` ORM model.
- **`backend/routers/entities.py`**: Added `?region_id=` query param to `GET /entities`; filters Redis entity cache by `region_id` field.
- **`poller/pollers/ais.py`**: `_run_aisstream()` now calls `load_regions()` and builds a multi-bbox `BoundingBoxes` list for AISstream.io subscription; falls back to single global bbox when no regions configured.

### J2 — Mesh Network Routing Visualization
- **`db/init/07_mesh_links.sql`**: New `mesh_links` table (`source_url`, `node_a`, `node_b`, `snr`, `link_quality`, `last_seen`) with unique constraint and indexes.
- **`backend/db/models.py`**: Added `MeshLink` ORM model with `UniqueConstraint` on `(source_url, node_a, node_b)`.
- **`poller/pollers/meshcore.py`**: Added `_fetch_neighbors()` (GETs `/api/neighbors`, returns `[]` on 404/error) and `_upsert_mesh_links()` (asyncpg ON CONFLICT upsert); called each `_contact_poll_loop` cycle.
- **`backend/routers/mesh.py`**: New `GET /api/v1/mesh/links` (recent links with `?stale_minutes=`) and `GET /api/v1/mesh/topology` (adjacency graph) endpoints.
- **`backend/main.py`**: Registered `mesh` router at `/api/v1`.
- **`frontend/src/components/layers/MeshLinksLayer.tsx`**: MapLibre GeoJSON `LineLayer` connecting mesh nodes; color-coded by SNR (green ≥ −70 dBm, amber ≥ −90 dBm, red < −90 dBm); polls every 30 s; cleans up on unmount.
- **`frontend/src/components/Map.tsx`**: Wires `MeshLinksLayer` after `RegionLayer`.

### J3 — Progressive Web App (PWA)
- **`frontend/public/manifest.json`**: Web App Manifest (`display: standalone`, `theme_color: #FFB800`, SVG icon reference).
- **`frontend/public/icon.svg`**: Vertex brand mark (scope corners + diamond + amber center) as standalone SVG for PWA icon.
- **`frontend/src/sw.ts`**: Full Workbox service worker — `precacheAndRoute` for build assets, `CacheFirst` for map tiles (7-day / 500 entries), `NetworkFirst` for `/api/` responses, `StaleWhileRevalidate` for static assets, notification click handler.
- **`frontend/vite.config.ts`**: Added `VitePWA` plugin with `injectManifest` strategy pointing to `src/sw.ts`; outputs `dist/sw.js` at build time.
- **`frontend/index.html`**: Added `<link rel="manifest">`, `theme-color` meta, Apple PWA meta tags, `apple-touch-icon`.
- **`frontend/src/components/InstallPrompt.tsx`**: Captures `beforeinstallprompt` event; renders amber install banner at bottom-center with dismiss.
- **`frontend/src/App.tsx`**: Renders `<InstallPrompt />` inside Dashboard.
- **`frontend/tsconfig.json`** / **`tsconfig.sw.json`**: Separated SW type-checking (WebWorker lib) from app tsconfig to avoid `self` global conflicts.
- **`frontend/public/sw.js`** (deleted): Replaced by compiled Workbox output from `sw.ts`.
- **`ROADMAP.md`**: J1/J2/J3 marked Done; Sprint 12 marked ✓ Complete.
- **Motivation**: J1 completes multi-region data ingestion so AIS vessels are tagged by region and filterable per-zone. J2 makes mesh RF topology visible on the map — operators can spot weak links and coverage gaps. J3 enables home-screen install and offline tile caching for field use from phones on the LAN.

## 2026-05-09 — Sprint 11: I2 Docker Resource Limits + I3 Pi 5 Systemd Auto-Start + J1 Multi-Region Monitoring (partial)

### I2 — Docker Resource Limits & Restart Policies
- **`docker-compose.yml`**: Added `deploy.resources.limits/reservations` to all five services — db (1 GB / 2 CPU, reservations 256 MB / 0.5 CPU), redis (256 MB / 0.5 CPU), backend (512 MB / 1 CPU), poller (384 MB / 1 CPU), frontend (128 MB / 0.5 CPU), tileserver (512 MB / 1 CPU). Added `ulimits.nofile` soft/hard 65536 to backend and poller.

### I3 — Systemd Unit & Pi 5 Auto-Start
- **`infra/vertex.service`**: Systemd unit — `After=docker.service network-online.target`, `ExecStart=/usr/bin/docker compose up --remove-orphans`, `Restart=on-failure`, `RestartSec=10s`, `TimeoutStartSec=120`.
- **`infra/install.sh`**: First-time Pi 5 setup — root check, installs docker.io/docker-compose-plugin/curl/git, enables Docker, clones or pulls repo to `/opt/vertex`, copies `.env.example` if `.env` absent, installs and starts the systemd unit, prints LAN URL.
- **`infra/update.sh`**: Upgrade script — `git pull --ff-only`, `docker compose pull`, `systemctl restart vertex`.
- **`README.md`**: New `## // 07 · PI 5 DEPLOYMENT` section covering prerequisites, install, update, and service management.

### J1 — Multi-Region / Multi-Bbox Monitoring (partial: config schema + backend + frontend)
- **`config/sources.example.yml`**: Added top-level `regions:` list with `id`, `name`, `bbox` (min_lat/max_lat/min_lon/max_lon), `enabled`. One enabled home region; one commented-out coast example.
- **`poller/config.py`**: Added `RegionBbox` and `RegionConfig` Pydantic models; added `load_regions()` — reads from `sources.yml`, falls back to single env-var bbox.
- **`backend/routers/config_regions.py`**: New `GET /api/v1/config/regions` endpoint; reads `sources.yml`, falls back to settings bbox.
- **`backend/main.py`**: Registers `config_regions` router at `/api/v1`.
- **`frontend/src/hooks/useRegions.ts`**: `useRegions()` hook fetching regions from the new endpoint.
- **`frontend/src/components/layers/RegionLayer.tsx`**: MapLibre GeoJSON layer rendering enabled region bboxes as amber dashed outlines on the live map.
- **`frontend/src/components/Map.tsx`**: Wires in `useRegions` and `RegionLayer` after `AnnotationOverlay`.
- **`frontend/src/admin/AdminFeeds.tsx`**: Adds a "Regions" tab listing each region's name, id, bbox, and enabled status.
- **`ROADMAP.md`**: I2/I3 marked Done, J1 marked In Progress, Sprint 11 marked ✓ Complete.
- **Motivation**: I2 prevents OOM crashes on Pi 5 under ADS-B peak load. I3 makes Vertex a true appliance that survives power loss. J1 partial lays the config + UI foundation for multi-zone monitoring; remaining pollers (AIS, weather) and `region_id` FK migration are Sprint 12.

## 2026-05-09 — Sprint 10: H2 Backend Test Suite Expansion + H4 WebSocket Per-Client Filtering

### H2 — Backend Test Suite Expansion
- **`backend/tests/test_auth.py`** (491 lines, 40 tests): JWT payload helpers, `_hash_api_key`, `SetupRequest`/`CreateUserRequest` Pydantic validation, and all 6 auth route endpoints (status, setup, login, /me, users CRUD, API key generate/revoke). Uses real SQLAlchemy `DeclarativeBase` stub so ORM column descriptors work in `select()` calls without a live DB.
- **`backend/tests/test_entities.py`** (240 lines, 16 tests): List endpoint with entity_type filter, pagination (limit/offset), bbox in/out/mixed, no-position entity exclusion, bad bbox 400, entity-by-id 200/404.
- **`backend/tests/test_alertrules.py`** (362 lines, 25 tests): `AlertRuleCreate`/`AlertRuleUpdate` Pydantic validation (all trigger types, cooldown_seconds, max_per_hour, dedup_key) plus full CRUD routes including 404/400 error cases.
- **`backend/tests/test_observations.py`** (326 lines, 14 tests): Replay endpoint (grouped response, multiple entities, include_events, 50k-row LIMIT cap, 422 for missing params) and trail endpoint (default minutes, out-of-range 422).
- **`backend/tests/test_websocket_unit.py`** (287 lines, 34 tests): Unit tests for `_entity_passes_filter()` — all combinations of bbox/type filters, boundary conditions, no-position passthrough, and non-entity_update message passthrough.
- Total: 139 tests passing (`python3 -m pytest tests/ -v`). No live DB or Redis required.

### H4 — WebSocket Per-Client Filtering
- **`backend/routers/ws.py`**: Added `_entity_passes_filter(data, sub_bbox, sub_entity_types)` helper. Added per-connection `sub_state` dict (`{"bbox": None, "entity_types": None}`) guarded by `asyncio.Lock`. Replaced `watch_disconnect()` with `watch_client_messages()` — parses JSON, handles `{"type":"subscribe","bbox":[...],"entity_types":[...]}` with input validation, updates `sub_state`. `forward_redis()` now deserializes `entity_update` messages, applies filter, skips if filtered out. Non-`entity_update` messages always pass through. Clients that never subscribe receive all events (backward compatible).
- **`frontend/src/hooks/useWebSocket.ts`**: Added `FILTER_KEY_TO_ENTITY_TYPE` mapping, `buildSubscription()` (returns null when all filters at default to avoid unnecessary traffic), and `sendSubscription()`. Sends initial subscription on `onopen`. Registers a Zustand store subscriber that re-sends on `entityFilter` changes; cleaned up on unmount.
- **`ROADMAP.md`**: H2 and H4 status updated to Done; Sprint 10 marked ✓ Complete.
- **Motivation**: H2 closes the zero-coverage gap on core backend paths before further feature work. H4 reduces WebSocket bandwidth 10–50× on busy deployments (500+ aircraft) by filtering entity_update messages server-side before forwarding.

## 2026-05-09 — Fixed entity_id VARCHAR(64) overflow for MeshCore node IDs

- **Root cause**: `entities.entity_id` (and FK columns on `observations`, `events`, `entity_mission_tags`) was `VARCHAR(64)`. MeshCore node IDs are prefixed hashes — e.g. `mesh_node:` (10 chars) + 64-char SHA256 = 74 chars — exceeding the limit and causing `StringDataRightTruncationError` on every mesh node DB write.
- **`db/init/01_schema.sql`**: Widened `entity_id` to `VARCHAR(255)` on `entities` (PK), `observations` (FK), and `events` (FK) for clean installs.
- **`db/init/04_entity_mission_tags.sql`**: Widened `entity_id` FK to `VARCHAR(255)`.
- **`poller/db.py`**: Added four `ALTER TABLE ... ALTER COLUMN entity_id TYPE VARCHAR(255)` migrations to `init_db()` so the running database is widened on next poller restart — no volume wipe required. PostgreSQL ALTER on a VARCHAR PK cascades to dependent FK columns automatically.
- **Validation**: Poller restarted cleanly with no migration errors. Python syntax check passed.

## 2026-05-09 — Fixed Mesh Node and Fire icon rendering to match design guide

- **Root cause identified**: Fire (`hazard` type) and Mesh Node icons were collapsing to a plain `dot` glyph at mid-zoom (6–8) instead of showing their distinctive shaped icons. Fire entities (wildfire incidents) are regional and almost always viewed at mid-zoom, making them visually indistinguishable from dots. Mesh nodes similarly degraded to a generic `ring` at mid-zoom instead of the hex chip.
- **`frontend/src/layers/buildEntityLayers.ts`**:
  - Added `hazard` (`fire_incident`) to the mid-zoom full-icon whitelist alongside `air`, `sea`, and `tak` — fire icons now show the flame shape at zoom >= 6.
  - Added explicit `FIRE_ICON_COLOR` constant matching design guide `--cat-fire #FF5252` (`[255, 82, 82, 230]`). Fire entities were previously getting an imprecise warm-orange from the generic `entityColor()` path.
  - Wired `FIRE_ICON_COLOR` into `getColor` for `hazard` type tracks.
- **`frontend/src/layers/buildMeshNodeLayer.ts`**:
  - Changed `iconForZoom` threshold so the hex chip icon (`'mesh'`) renders at zoom >= 6 instead of the generic `ring`; adjusted mid-zoom size from 12 → 16px.
- **`frontend/src/layers/atlasIcons.ts`**:
  - Added design-guide SVG coordinate comments to Mesh Node and Fire canvas draw blocks referencing the exact `atlas-mesh` / `atlas-fire` symbol paths (×2 scale from 32px grid).
  - Corrected fire inner core void from solid black to `rgba(0,0,0,0.6)` matching `opacity="0.6"` in the design guide.
- **Validation**: `cd frontend && node node_modules/typescript/bin/tsc --noEmit` ✓ zero errors.

## 2026-05-09 — Hardened lightning strike ingestion and Deck.gl rendering safety

- Updated `frontend/src/store.ts` lightning ingestion path:
    - Added timestamp normalization to accept seconds, milliseconds, nanoseconds, and ISO strings.
    - Added strict lat/lon validation and freshness window filtering to reject stale/future malformed strikes.
    - Kept rolling lightning buffer bounded while preserving fresh in-window points.
- Updated `frontend/src/layers/buildLightningLayer.ts` rendering path:
    - Added coordinate/time guards before layer build.
    - Clamped age-to-size and age-to-alpha calculations to `[0, 1]` to prevent oversized or invalid color/size output from malformed future timestamps.
    - Enabled billboard rendering for consistent icon visibility during map pitch changes.
- Validation:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - Published synthetic lightning feed with current timestamps via Redis (`PUBLISH civic:updates`) and confirmed subscribers received the update (`(integer) 4`).

## 2026-05-09 — Fixed lightning full-screen yellow wash (render clock mismatch)

- Root cause identified in `frontend/src/components/MapOverlay.tsx`:
    - The animation frame clock (`performance.now()` RAF time) was being passed to time-based layers (`buildLightningLayer`, `buildEventLayers`) that expect Unix epoch milliseconds.
    - This mismatch produced extreme negative ages for epoch timestamps, which in the lightning size formula could expand icons into massive screen-filling yellow quads.
- Fix implemented:
    - Added `const nowMs = Date.now()` inside the render loop and passed `nowMs` (epoch) to both time-based layer builders.
- Validation:
    - `npx tsc --noEmit` ✓
    - Rebuilt frontend with Docker Compose (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d frontend`) ✓
    - Retested with Lightning ON and Smoke OFF plus fresh Redis-injected strikes: map remains normal dark theme; no full-screen yellow wash.

## 2026-05-09 — Sprint 7: P25 audio archiving, scan priority enforcement, scheduled SitRep, F1 roadmap update

- **F1 (ATAK CoT Ingest)**: Confirmed `poller/pollers/cot_receiver.py` and `CotReceiver` poller already fully implement TCP-based CoT ingest from openTAK — updated `ROADMAP.md` to mark F1 as Done.
- **G1 (Scheduled SitRep Delivery)**: Created `backend/sitrep_scheduler.py` — background task that polls DB every minute for `AlertRule` records with `action_type="sitrep_delivery"`, generates SitRep markdown, and POSTs to a configured webhook URL on the configured `interval_hours` schedule using Redis to track last-run timestamps.
- **G1**: Extended `backend/routers/alertrules.py` — added `sitrep_delivery` to `action_type` Literal and `scheduled` to `trigger_type` Literal; added `interval_hours` validation; updated `webhook_dispatcher.py` to skip `scheduled` rules from the event stream.
- **G1**: Updated `backend/main.py` lifespan to start `run_sitrep_scheduler()` as a background task alongside the webhook dispatcher.
- **G1**: Updated `frontend/src/components/layout/AlertRulesSection.tsx` — added "Scheduled SitRep" action type option; shows interval/window hour fields when selected; trigger selector hidden for sitrep rules; existing rule display shows interval.
- **F2 (Talkgroup Scan Priority)**: Updated `poller/pollers/p25.py` — P25Poller now loads talkgroup priorities from DB at startup and refreshes every 60 polls; annotates `radio:active` feed with the active TGID's priority; enforces scan time budgets (P1=never skip, P2=120s, P3=60s, P4=30s, P5=15s) by sending OP25 `skip` commands when exceeded; priority included in `p25_call_start/end` event details.
- **F2**: Extended `frontend/src/storeTypes.ts` `RadioState` with optional `priority` field; updated `frontend/src/components/panels/TacticalAudio.tsx` to show P1/P2 priority badge next to the LIVE indicator when an active call has a high-priority talkgroup.
- **E2 (P25 Audio Archiving)**: Added `P25Recording` SQLAlchemy model to `backend/db/models.py` (auto-created via `create_all`); added `p25_audio_enabled`, `p25_audio_dir`, `p25_audio_retention_days` to `poller/config.py`; added `p25_audio_dir` to `backend/config.py`.
- **E2**: Created `poller/pollers/p25_recorder.py` — `P25AudioRecorder` subscribes to `civic:updates` Redis channel; on `p25_call_start` streams the first enabled Icecast RadioStream URL to `/data/audio/{date}/{tgid}/{call_id}.mp3`; on `p25_call_end` closes and persists a DB record; includes daily cleanup of recordings older than `p25_audio_retention_days`; disabled by default (`P25_AUDIO_ENABLED=false`).
- **E2**: Extended `backend/routers/radio.py` with `GET /radio/recordings` (paginated, tgid/hours filters) and `GET /radio/recordings/{id}/file` (path-validated `FileResponse`).
- **E2**: Updated `frontend/src/components/panels/ChannelsPanel.tsx` — added third "REC" tab; loads recordings from API when tab active; click-to-play/pause via `<audio>` ref; shows talkgroup name, timestamp, and duration per recording.
- **Validation**: `cd frontend && npx tsc --noEmit` ✓; Python syntax check on all modified `.py` files ✓; `docker compose config` ✓.

## 2026-05-08 — Standardized dashboard glassmorphism and map background
- Refactored global layout in `App.tsx` to move the map to a fixed background layer (`z-0`) with `pointer-events-none` on UI containers to allow click-through map interactions.
- Added a centralized `hud-panel` CSS utility in `index.css` to provide a consistent frosted glass aesthetic (backdrop blur, translucent dark background, rounded corners).
- Upgraded floating panels (`PlaybackController`, `AnnotationOverlay` toolbar and modals, Geofence sidebar) to use the new `hud-panel` style, removing high-contrast solid colors and gold outlines.
- Removed opaque `bg-onyx-black` and `bg-onyx-deep` backgrounds from major dashboard tabs (`InfrastructureGrid`, `CommunityPanel`, `EnvironmentPanel`, `EventLogPanel`) so the map gracefully shines through the entire UI.
- Improved `EnvironmentPanel` UX by removing the automatic trigger that turned on the weather radar layer globally when the panel was opened.
- Restored NEXRAD weather radar colors by removing the blanket `grayscale(100%)` CSS filter from the global MapLibre canvas.
- Validation:
    - UI checked and verified translucent panel backgrounds render correctly.

## 2026-05-08 — Replaced compact rail abbreviations with icon counters
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) compact collapsed counters from 3-letter labels to icon + count buttons for visual consistency with expanded state.
- Preserved existing click actions for quick filter/overlay focus from each counter.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Made compact sidebar counters clickable for quick filter focus
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) so compact rail counters are interactive actions.
- Added one-click filter focus presets for entity-backed categories (AIR, SEA, APR, FIR, MES, SAT, TGS) that jump to safety view and apply matching map/search filters.
- Added overlay focus actions for STM, LTG, and CAM counters to jump to safety view and enable stream gauge, lightning, or camera overlays.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Defaulted sidebar to collapsed and expanded map entity counters
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) so first-load behavior defaults to collapsed (while still honoring persisted operator preference).
- Extended sidebar counters to include additional rendered map categories: APRS, fire incidents, stream gauges, lightning strikes, satellites, TinyGS stations, mesh nodes, plus existing aircraft/vessels/cameras.
- Added the expanded counter set to both full sidebar and compact rail views for quick at-a-glance totals.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Added collapsible left sidebar with compact rail mode
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) to support collapse/expand via a header toggle.
- Added persisted sidebar state (`vertex.sidebar.collapsed`) so the chosen width is restored across reloads.
- Implemented compact collapsed rail with quick-access icons (Overview, Incidents, Environment, Community), live counts, and connection indicator.
- Preserved full existing sidebar content/behavior when expanded.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Added marquee motion for advisory subject text
- Updated [frontend/src/components/layout/AlertStatusBar.tsx](frontend/src/components/layout/AlertStatusBar.tsx) to render the advisory subject/message as a continuous scrolling marquee instead of a hard truncation.
- Updated [frontend/src/index.css](frontend/src/index.css) with `alert-marquee` keyframes and utility classes for seamless horizontal ticker motion.
- Preserved click-through behavior so selecting the banner still opens detailed advisory context.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Streamlined congested entity filter panel
- Updated [frontend/src/components/panels/EntitySearchPanel.tsx](frontend/src/components/panels/EntitySearchPanel.tsx) to reduce visual congestion by introducing a collapsible Advanced Filters section.
- Moved ADS-B source toggles and altitude/speed range sliders behind the new Advanced Filters disclosure.
- Kept high-frequency controls (entity types, tagged-only, history trails) visible in the default filter view for faster map interaction.
- Added active-state highlighting on the Advanced Filters button when advanced criteria are applied.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Added history trail toggle to global settings drawer
- Added a Map Layers toggle in [frontend/src/components/layout/SettingsPanel.tsx](frontend/src/components/layout/SettingsPanel.tsx) for History Trails using the shared store state.
- This keeps the global settings drawer and entity filter panel in sync because both now drive the same `trailsVisible` store flag.
- Validation:
    - `cd frontend; npx tsc --noEmit` ✓

## 2026-05-08 — Added history trail visibility toggle with CoT click override
- Added trail visibility UI control in [frontend/src/components/panels/EntitySearchPanel.tsx](frontend/src/components/panels/EntitySearchPanel.tsx) so operators can toggle history trails on/off directly from the filters panel.
- Added `trailsVisible` store state and setter in [frontend/src/store.ts](frontend/src/store.ts), and wired reset behavior so "Reset all filters" restores trail visibility.
- Updated trail rendering pipeline in [frontend/src/layers/buildTrailLayers.ts](frontend/src/layers/buildTrailLayers.ts) and [frontend/src/components/MapOverlay.tsx](frontend/src/components/MapOverlay.tsx):
    - When trails are on, behavior is unchanged.
    - When trails are off, non-selected history trails are hidden.
    - If a selected object is CoT (`tak_client` track), its trail still renders while trails are globally hidden.
- Validation:
    - `cd frontend; npm install; npx tsc --noEmit` ✓

## 2026-05-08 — Restored broken ADS-B pipeline and fixed snapshot hydration
- 2026-05-08 — Fixed infinite loop in Redis hydration caused by `cur = b"0"` mismatch.
- 2026-05-08 — Fixed `CotEmitter` channel subscription; changed from `entity_update` to `civic:updates`.
- 2026-05-08 — Verified live aircraft rendering (50+ units) and successful BEAST/OpenSky source arbitration.
- 2026-05-08 — Fixed broken WebSocket aircraft snapshot handler:
  - Issue discovered: Previous fix had two `break` statements that skipped the entire `setAircraftSnapshot()` call, causing all aircraft data to be dropped from the frontend store when BEAST was healthy but a snapshot burst was empty.
  - Patch: Introduced `shouldSkipSnapshot` boolean flag to ensure `setAircraftSnapshot` is still called for valid updates while correctly suppressing transient empty/degraded bursts.

## 2026-05-08 — Hardened ADS-B snapshot handling against transient near-empty wipes

## 2026-05-08 — Fixed broken WebSocket aircraft snapshot handler

- **Issue discovered**: Previous fix had two `break` statements that skipped the entire `setAircraftSnapshot()` call, causing all aircraft data to be dropped from the frontend store even though it was correctly arriving in Redis and being sent by the backend. Sidebar showed "Aircraft: 0" despite 11 aircraft in the snapshot.
- **Root cause**: Using `break` in the case statement exited before reaching the `setAircraftSnapshot(aircraft)` line, so suppression of transient snapshots also suppressed normal snapshot updates.
- **Frontend fix** (`frontend/src/hooks/useWebSocket.ts`):
    - Replaced aggressive `break` statements with a `shouldSkipSnapshot` boolean flag.
    - Now only skips the snapshot update for transient bad snapshots, but still calls `setAircraftSnapshot()` in normal cases.
    - Preserved degraded-snapshot and empty-snapshot guards to handle Mode D transient snapshot gaps.
- **Validation**:
    - `cd frontend && npm install && npx tsc --noEmit` ✓
    - `docker compose up -d --build frontend` ✓
    - Browser reload shows "Aircraft (ADS-B): 11" ✓

## 2026-05-08 — Hardened ADS-B snapshot handling against transient near-empty wipes

- **Issue observed**: In Mode D, operators could briefly see ADS-B tracks and then lose most/all aircraft icons even while local decoder health appeared normal.
- **Frontend fix** (`frontend/src/hooks/useWebSocket.ts`):
    - Added a degraded-snapshot guard for `aircraft_snapshot` frames.
    - While `beast_healthy=true` and frame age remains fresh, ignore short bursts where local aircraft count drops to a severe fraction of the currently rendered local set.
    - Preserved existing empty-snapshot burst protection and reset logic so legitimate sustained drops still apply after a short streak.
- **Validation**:
- **Validation**:
    - `cd frontend && npm install && npx tsc --noEmit` ✓ (later revised to fix break statement issue)

## 2026-05-08 — Fixed backend/poller duplicate index startup race

- **Issue observed**: Backend startup intermittently crashed with `IntegrityError`/`UniqueViolationError` involving `ix_annotations_tak_uid` and `pg_class_relname_nsp_index` during concurrent container startup.
- **Fix implemented**:
    - Updated `backend/db/session.py` migration loop to catch known-safe duplicate-relation race errors for `ix_annotations_tak_uid` and continue startup.
    - Removed redundant `ix_annotations_tak_uid` index creation from `poller/db.py` so backend owns that index migration path, reducing cross-service DDL contention.
- **Validation**:
    - `python -m py_compile backend/db/session.py poller/db.py` ✓
    - `docker compose up -d --build backend poller` ✓
    - `docker compose logs --tail=200 backend` ✓ (no IntegrityError/UniqueViolationError/index race errors)

## 2026-05-08 — Optimized ICAO normalization with regex

- **Performance Optimization**: Replaced suboptimal generator expressions in `any()` with pre-compiled regular expressions in `poller/enrichment/aircraft_db.py` and `poller/enrichment/adsbdb.py`.
    - This change optimizes the ICAO hex code normalization hot path, which is called for every aircraft in every poll cycle.
    - Measured a **~35% speedup** in the normalization function (from 7.66s down to 4.93s per 1M iterations).
- **Validation**:
    - Verified functional correctness using `poller/tests/test_adsb_normalization.py`.
    - Performance verified with a dedicated benchmark script.

## 2026-05-07 — Hardened poller payload sanitization for DB/Redis writes

- **Issue observed**: Poller persistence failed on APRS entities when upstream payloads contained null bytes (`\u0000`), producing asyncpg `UntranslatableCharacterError` during entity writes.
- **Root fix**:
    - Added shared sanitization helpers in `poller/sanitize.py` to strip null bytes from strings and recursively sanitize nested payloads.
    - Updated `poller/bus.py` to sanitize entity/feed/snapshot payloads before Redis key/value writes and websocket publishes.
    - Updated `poller/db.py` to sanitize entity/event fields before Postgres inserts and JSONB serialization.
    - Updated `poller/geofence.py`, `poller/pollers/p25.py`, `poller/pollers/seismic.py`, `poller/pollers/meshcore.py`, `poller/pollers/anomaly.py`, and `poller/pollers/base.py` so direct publish paths also use sanitized payloads.
- **Additional hardening**:
    - Updated `poller/normalizers/vessel.py` to safely handle non-string ship names instead of calling `.strip()` on raw upstream values.
- **Validation**:
    - `python -m py_compile poller/sanitize.py poller/bus.py poller/db.py poller/geofence.py poller/normalizers/vessel.py` ✓
    - `python -m py_compile poller/pollers/p25.py poller/pollers/seismic.py poller/pollers/meshcore.py poller/pollers/anomaly.py poller/pollers/base.py` ✓

## 2026-05-07 — Reduced APRS and stream gauge map icon sizes

- Updated `frontend/src/layers/buildEntityLayers.ts` to reduce APRS (`ground`) icon size at close zoom:
    - Default: `24px` (was `32px`)
    - Selected: `30px` (was `40px`)
- Updated `frontend/src/layers/buildStreamGaugeLayer.ts` gauge icon sizes:
    - Far: `7px` (was `8px`)
    - Mid: `10px` (was `12px`)
    - Close: `18px` (was `22px`)
- Updated `docs/map-key.md` to keep symbol-size documentation in sync.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-07 — Reduced ADS-B enrichment queue saturation under load

- **Issue observed**: `pollers.adsb` repeatedly logged `enrichment queue full (256), dropping enrichment request` under high traffic after bounded queue rollout.
- **Root cause** in `poller/pollers/adsb.py`:
    - Missing enrichments were re-enqueued each snapshot tick before prior lookups entered cache/inflight state.
    - Burst enqueue behavior could fill the bounded queue in a single tick, causing repeated drop warnings.
- **Fix implemented**:
    - Added pending-dedupe sets for route callsigns, aircraft ICAOs, and METAR ICAOs.
    - Added typed helper schedulers (`_schedule_route_enrichment`, `_schedule_aircraft_enrichment`, `_schedule_metar_enrichment`) that dedupe and clear pending state on completion/failure.
    - Updated `_schedule_enrichment(...)` to return enqueue success so pending state can be rolled back when queue is full.
    - Added queue-aware per-tick budgeting in `_enrich_aircraft_cache_only(...)` so new enrichment requests are throttled by queue headroom rather than burst-enqueued.
- **Expected impact**: Dramatically fewer duplicate queued enrichments and reduced queue-full/drop-warning storms while preserving bounded-memory behavior.
- **Validation**:
    - `python -m py_compile poller/pollers/adsb.py` ✓

## 2026-05-07 — Implemented Best Mode ADSB arbitration and stabilized backend rate-limiting

- **ADS-B Best Mode Arbitration**: Refactored `poller/pollers/adsb.py` to maintain a unified aircraft registry.
    - Implemented source-aware arbitration (Hierarchy: BEAST > UltraFeeder > OpenSky) based on 12s freshness windows.
    - Enabled concurrent polling of BEAST (TCP) and UltraFeeder (HTTP) sources to ensure data continuity during local network fluctuations.
    - Unified the 1Hz aircraft snapshot emission into a single tick loop, preventing visual flickering and redundant enrichment processing.
- **API Performance & Stability**:
    - **Backend**: Increased `RateLimitMiddleware` to 600 calls per 60s in `backend/main.py` to support high-density tactical displays and background polling.
    - **Frontend Hydration**: Overhauled `frontend/src/hooks/useTrailHydration.ts` with a staggered request queue (400ms delay) and 429 backoff logic. This prevents the "thundering herd" of REST requests on initial map load that previously triggered rate limits.
    - **Redundant Polling**: Optimized `frontend/src/config.ts` to increase background polling intervals (Alerts/News/Weather/Cameras) by 4-10x, leveraging WebSocket updates as the primary source and REST as a reliable fallback.
- **Rendering Quality**:
    - Finalized MapOverlay cadence at 16ms (60fps) and removed interaction gates that caused map-pan stutter.
    - Fixed Z-index ordering in `MapOverlay.tsx`: Background layers (Geofences, Custom Layers, Observation Rings) are now moved to the bottom of the stack, ensuring tactical entities (Aircraft, Vessels) and manual Annotations render on top and remain unobstructed.
    - Hardened trail continuity: Increased the "gap bridge" threshold to 15km and history segmentation to 10 minutes to maintain solid lines for high-speed aircraft during transient signal fades.
    - Map Lifecycle Stability: Hardened all MapLibre sub-components (`AnnotationOverlay`, `TerrainLayer`, `SmokeLayer`, `GeofenceLayer`) with defensive null-checks and try/catch blocks to prevent crashes during Hot Module Replacement (HMR) or component unmounting.
    - Poller Resilience: Implemented adaptive exponential backoff (up to 1 hour) for OpenSky Network ADSB polling to handle 429 rate-limiting gracefully and reduce log noise.
    - Data Relevance: Implemented time-fencing for fire incidents (30 days for local, 14 days for regional) to eliminate "undead" historical incidents from the tactical dashboard.
    - Validated PVB adaptive blending logic for local sources to ensure smooth motion and minimal latency.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓ (Passed)
    - `python -m py_compile backend/main.py poller/pollers/adsb.py` ✓ (Passed)
    - `docker compose config --quiet` ✓ (Passed)

## 2026-05-06 — Fixed ADS-B icon reset/repopulate loops and BEAST smoothing regression

- Root cause refinement after container/browser refresh: map behavior indicated a combination of transient empty aircraft snapshots, excessive BEAST update churn, and frontend blend-state reset conditions.
- Updated `frontend/src/layers/pvb.ts` report-key logic so BEAST `last_seen` heartbeats no longer reset smoothing when there is no new resolved position (prefers trail timestamp when available).
- Updated `frontend/src/hooks/useWebSocket.ts` to ignore short bursts of empty `aircraft_snapshot` payloads while BEAST is healthy, preventing full icon wipe/repopulate cycles from transient snapshot gaps.
- Updated `frontend/src/hooks/useTrailHydration.ts` to include auth headers on trail fetches, eliminating unauthorized per-aircraft trail requests under auth-enabled deployments.
- Updated `poller/bus.py` change detection to stop treating highly volatile BEAST counters (`msg_count`, `mlat_ticks`, `signal_peak`) as publish triggers, reducing frontend update spam and improving motion continuity.
- Validation: `cd frontend && npx tsc --noEmit` ✓ · `python -m py_compile poller/bus.py` ✓

## 2026-05-06 — Diagnosed ADS-B rubberbanding and hardened local/supplement smoothing

- Root-cause diagnosis focused on local BEAST/UF motion artifacts under supplement mode: frontend PVB update detection relied only on trail timestamp changes and continued dead-reckoning even when decoder marked positions stale.
- Updated `frontend/src/storeTypes.ts` and `frontend/src/entityUtils.ts` so `Track` now carries `lastSeen` and `positionStale` metadata from aircraft entities.
- Updated `frontend/src/layers/pvb.ts` to:
    - detect new reports with a richer signature (source + lastSeen + trail timestamp + pose/freshness) instead of trail timestamp alone,
    - freeze extrapolation speed to `0` when `position_stale=true` to prevent stale-track drift and snapback,
    - re-anchor immediately when source changes (local ↔ OpenSky) to avoid blending across disjoint track histories.
- Tuned OpenSky supplement defaults and holdoff behavior:
    - changed default `adsb_opensky_interval` from `60` → `240` in `poller/config.py` and `.env.example` to reduce anonymous rate-limit churn,
    - capped effective local holdoff in `poller/pollers/adsb.py` at 90s to prevent excessively long local-authoritative windows when using high supplement intervals.
- Validation: `cd frontend && npx tsc --noEmit` ✓ · `python -m py_compile poller/pollers/adsb.py poller/config.py` ✓

## 2026-05-06 — Reduced BEAST startup false-positive unhealthy log noise

- Updated `poller/pollers/adsb.py` to add a 15-second BEAST warm-up window before logging `BEAST unhealthy — HTTP fallback active`.
- Added transition-aware fallback logging so unhealthy/healthy messages only emit on state changes instead of every cycle.
- Validation: `python -m py_compile poller/pollers/adsb.py` ✓ · `docker compose up -d --build poller` ✓

## 2026-05-06 — Standardized AIS chevron icon and fixed OpenSky supplement wipeout

- Updated `frontend/src/layers/atlasIcons.ts` to remove the legacy vessel hull/mast icon and render both aircraft and vessel as clean CoT-style chevrons (no tail fin extension).
- Updated `frontend/src/store.ts` `setAircraftSnapshot(...)` to preserve OpenSky-supplement aircraft between local `aircraft_snapshot` replacements, preventing the "appears briefly then disappears" behavior when supplement mode is active.
- Added ADS-B source filtering controls in `frontend/src/components/panels/EntitySearchPanel.tsx` and store state (`adsbLocal`, `adsbSupplement`) so operators can toggle local BEAST/ultrafeeder tracks and OpenSky supplement tracks independently.
- Updated render filtering in `frontend/src/components/MapOverlay.tsx` to apply those source-level ADS-B toggles and avoid mixing local/supplement displays when operators want one source only.
- Tuned motion smoothing in `frontend/src/layers/pvb.ts` to use a source-aware adaptive blend window (longer for sparse OpenSky updates, short for local feeds) to keep BEAST fidelity while reducing rough supplement jumps.
- Updated `poller/pollers/adsb.py` so Mode D supplement startup in BEAST mode is no longer gated on configured HTTP ADS-B sources, and added INFO-level OpenSky poll lifecycle/cadence logs.
- Added an effective local holdoff threshold in `poller/pollers/adsb.py` (`max(stale_threshold, interval + 5)`) to reduce rapid local↔OpenSky source flapping.
- Validation: `cd frontend && npx tsc --noEmit` ✓


## 2026-05-06 — Atlas map key documentation sync and icon priority tuning

- Updated entity rendering in `frontend/src/layers/buildEntityLayers.ts` so ADSB/AIS retain full icons at mid zoom and now use the same icon size as close zoom (default `32px`, selected `40px`).
- Updated lightning rendering in `frontend/src/layers/buildLightningLayer.ts` so mid zoom uses the same base icon size as close zoom (`18px`).
- Added `docs/map-key.md` as a dedicated map symbol key for end-user guidance and linked it from `docs/README.md` and root `README.md`.
- Added a new "Last Updated From Code" section to `docs/map-key.md` listing authoritative frontend source files to keep documentation synchronized with rendering behavior.
- Validation: `cd frontend && npx tsc --noEmit` ✓

## 2026-05-05 — Removed map icon clustering from frontend overlay

## 2026-05-05 — Hardened Stream Gauge map rendering and data fallback

- **Issue**: Stream gauge layer was enabled but operators reported no visible gauge markers despite poller logs showing successful ingest.
- **Frontend hardening** (`frontend/src/components/layers/StreamGaugeLayer.tsx`):
    - Added REST fallback fetch (`/api/v1/entities?entity_type=stream_gauge`) when websocket-derived `stream_gauge` entities are empty.
    - Added periodic fallback refresh (60s) so gauges remain visible even if websocket snapshot/entity updates miss that type.
    - Increased gauge marker/ring contrast and size for better visibility on the dark grayscale map treatment.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓


- **Request**: Roll back the icon clustering feature introduced in the prior frontend PR because the map behavior/UX was not meeting expectations.
- **Code changes**:
    - Removed clustering integration from `frontend/src/components/MapOverlay.tsx`.
    - Restored unconditional entity rendering path: trail layers + entity icon layers at all zoom levels.
    - Deleted obsolete `frontend/src/layers/buildClusterLayers.ts` implementation.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓

## 2026-05-05 — Sunset TinyGS integration by default

- **Issue observed**: `pollers.tinygs` repeatedly logged `404 Not Found` against `https://api.tinygs.com/v1/stations`, creating persistent warning noise without useful operational data.
- **Runtime change**:
    - Added `tinygs_enabled: bool = False` in `poller/config.py` (env: `TINYGS_ENABLED`).
    - Updated `poller/main.py` to only register `TinyGSPoller()` when `TINYGS_ENABLED=true`.
    - Added explicit startup log when disabled: `integration sunset by default`.
- **Docs/config update**: Added `TINYGS_ENABLED=false` and sunset note to `.env.example`.
- **Validation**:
    - `python -m py_compile poller/config.py poller/main.py` ✓
    - `docker compose up -d --build poller` ✓
    - Runtime logs now show `Started 17 pollers` and no TinyGS 404 warnings.

## 2026-05-05 — Fixed broken Blitzortung lightning WebSocket integration

- **Primary failure mode**: `pollers.lightning` attempted `wss://wsN.blitzortung.org:800N/` (legacy nonstandard ports), which consistently failed with `Connect call failed`.
- **Secondary failure mode after port fix**: some `wsN` hosts present mismatched TLS certs for their hostname, causing `CERTIFICATE_VERIFY_FAILED` when chosen randomly.
- **Code fix**: Updated `poller/pollers/lightning.py` to:
    - use standard WSS endpoint format (`wss://wsN.blitzortung.org/`, port 443),
    - restrict default host rotation to currently cert-valid hosts (`ws1`, `ws2`, `ws7`, `ws8`),
    - update protocol comments accordingly.
- **Validation**:
    - `python -m py_compile poller/pollers/lightning.py` ✓
    - `docker compose up -d --build poller` ✓
    - Runtime logs confirm successful subscribe: `pollers.lightning ... connecting to wss://ws8.blitzortung.org/` followed by `subscribed to Blitzortung feed`.

## 2026-05-04 — Added collapsible sidebar incidents feed for density control

- **Problem identified**: The sidebar incident feed consumed substantial vertical space when multiple incident cards were present, reducing scan efficiency for adjacent sidebar sections.
- **UX improvement**: Updated `frontend/src/components/layout/Sidebar.tsx` to make **Active Incidents** section-level collapsible from the header itself.
- **Behavior details**:
    - Added a title toggle with chevron and proper `aria-expanded` / `aria-controls` semantics.
    - Introduced smart default behavior: if there is no saved user preference, the section auto-collapses when active incidents are `>= 3`, and remains expanded for lighter loads.
    - Persisted operator preference in localStorage (`vertex.sidebar.incidentsCollapsed`) so manual collapse/expand choice sticks across reloads.
    - Added compact collapsed preview mode that shows only the top incident headline/time/location while preserving `View All` navigation.
- **Validation**: `cd frontend && npx tsc --noEmit` ✓ (no output, success).

## 2026-05-04 — Tuned collapsed/expanded sidebar incident counts

- **Follow-up UX change**: Updated `frontend/src/components/layout/Sidebar.tsx` so collapsed mode now shows the top 3 significant incidents (instead of 1), while expanded mode now shows all significant incidents (instead of capping at 4).
- **Count messaging**: "Showing X of Y incidents" now keys off the current mode (compact vs expanded), so the counter is accurate in both states.
- **Validation**: `cd frontend && npx tsc --noEmit` ✓ (no output, success).

## 2026-05-04 — Enabled click-to-expand in compact incident mode

- **UX refinement**: Updated compact (collapsed) incident rows in `frontend/src/components/layout/Sidebar.tsx` to expand inline when clicked.
- **Behavior**: In compact mode, clicking a row toggles expanded detail for that incident (description + "Open Incident Source" link) while keeping the sidebar section itself collapsed.
- **Accessibility**: Added `aria-expanded` semantics on each compact incident toggle.
- **Affordance update**: Added per-row chevron indicators (`expand_more` / `expand_less`) in compact mode so click-to-expand state is immediately visible.
- **Validation**: `cd frontend && npx tsc --noEmit` ✓ (no output, success).

## 2026-05-04 — Improved annotation label readability and draw preview visibility

- **Problem identified**: Annotation labels for markers and lines were visually colliding with geometry, and in-progress line/polygon drawing had no reliable visible preview while sketching.
- **Label rendering fix**: Updated Deck annotation text rendering in `frontend/src/layers/AnnotationLayer.tsx` to apply per-geometry text offsets (`getPixelOffset`) so marker and line labels are shifted away from the underlying symbol/stroke.
- **Draw preview fix**: Added a Deck-rendered draw preview pipeline so in-progress line/polygon geometry is always visible above the map stack:
    - Extended annotation store state in `frontend/src/store.ts` with `annotationDrawPoints`, `annotationDrawCursor`, and setter/clearer actions.
    - Updated `frontend/src/components/layers/AnnotationOverlay.tsx` to sync click/mousemove draw state into the store and clear preview state on finish/cancel.
    - Added `buildAnnotationDrawPreviewLayers(...)` in `frontend/src/layers/AnnotationLayer.tsx` (preview line, fill, and control points).
    - Wired preview layers into the render loop in `frontend/src/components/MapOverlay.tsx`.
- **Validation**: `cd frontend && npx tsc --noEmit` ✓ (no output, success).

## 2026-05-04 — Resolved frontend react-markdown module/type check failure

- **Problem identified**: Frontend type checking failed with `TS2307` in `frontend/src/components/panels/IncidentsPanel.tsx` reporting `Cannot find module 'react-markdown' or its corresponding type declarations`.
- **Root cause**: `react-markdown` was present in `frontend/package.json` but was not installed in the local `frontend/node_modules` tree (`npm ls react-markdown` returned empty).
- **Fix**: Installed the dependency in the frontend workspace with `npm install react-markdown@^10.1.0`.
- **Validation**: `cd frontend && npx tsc --noEmit` now completes with no output (success).

## 2026-05-04 — Fixed map visibility issue caused by aggressive CSS filter

- **Problem identified**: The map appeared "not loading" or blank.
- **Root cause**: A CSS filter on `canvas.maplibregl-canvas` with `brightness(0.6)` was making the dark-mode basemap indistinguishable from the black background on many displays.
- **Fix**: Adjusted the filter in `frontend/src/index.css` to `brightness(0.9)` and `contrast(1.1)`. This restores visibility of land and water features while preserving the intended tactical grayscale aesthetic.
- **Validation**: User confirmed the map is loading and visible; browser subagent verified vector tiles and labels were correctly rendering.

## 2026-05-04 — Surfaced Map Annotation tools in UI

- **Problem identified**: New Map Annotation features were hidden behind the Tactical Audio bar at the bottom of the screen.
- **Fix**: Created `AnnotationController` component to provide an explicit "ANNOTATE" button on the map (top-left toolbar area). Moved the annotation drawing toolbar to a safer `z-index` and position that doesn't conflict with the audio console.
- **Store update**: Added `annotationToolbarOpen` state to coordinate the trigger button and the toolbar.

## 2026-05-04 — Restored map render performance and added map error visibility

- **Performance regression identified**: `preserveDrawingBuffer: true` in `frontend/src/components/Map.tsx` was introduced with snapshot export work on 2026-05-03. Keeping the WebGL backbuffer alive every frame is a known MapLibre/WebGL performance cost and was the most plausible direct cause of the frontend slowdown.
- **Fix**: Made drawing-buffer preservation opt-in via `VITE_PRESERVE_DRAWING_BUFFER` and defaulted it to `false` in `frontend/src/config.ts`, `docker-compose.yml`, `docker-compose.dev.yml`, and `.env.example`.
- **Diagnostics**: Added explicit `map.on('error', ...)` logging in `frontend/src/components/Map.tsx` so future basemap/style failures surface real MapLibre errors in the console instead of presenting as a blank or under-drawn map.
- **Basemap verification**: Confirmed the default OpenFreeMap dark style, sprite, raster source, TileJSON, and a sample vector tile were reachable; no repository-side offline-tile setting was active in the current `.env`.
- **Validation**: diagnostics clean on touched files · combined dev compose config ✓ · restarted frontend service to apply the map initialization change.

## 2026-05-04 — Fixed offline tile env wiring and invalid style guard

- **Problem**: The offline tile configuration path was easy to misconfigure and could blank the map if `VITE_TILE_URL` was set to a raster tile template instead of a MapLibre style URL.
- **Root cause**: `frontend/src/config.ts` passes `VITE_TILE_URL` directly into MapLibre as the `style` value, so a URL like `/styles/basic-preview/{z}/{x}/{y}.png` is invalid for this code path. The existing Docker comment incorrectly suggested exactly that format.
- **Frontend hardening**: Updated `frontend/src/config.ts` to detect tile-template placeholders (`{z}`, `{x}`, `{y}`), ignore the invalid value, log a warning, and fall back to the default OpenFreeMap style instead of failing map initialization.
- **Dev-stack fix**: Added `VITE_TILE_URL` to `docker-compose.dev.yml` so offline tile selection is actually controllable via `.env` when running the Vite dev server override.
- **Docs fix**: Corrected the `docker-compose.yml` offline tileserver comment to document the proper style URL form: `http://localhost:8080/styles/basic-preview/style.json`.
- **Validation**: diagnostics clean on touched files · combined `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` ✓

## 2026-05-04 — Hardened TinyGS TLS handling and retry backoff

- **Problem**: `pollers.tinygs` was retrying every 15 seconds against `mqtt.tinygs.com:8883` with `CERTIFICATE_VERIFY_FAILED`, producing persistent error churn and unnecessary reconnect work whenever TinyGS presented its private CA chain.
- **Root cause verification**: Reproduced the TLS handshake failure inside the running `poller` container and decoded the presented broker certificate. The leaf for `mqtt.tinygs.com` is issued by `TinyGS Intermediary CA`, which is not trusted by the default public CA store.
- **Poller fix**: Updated `poller/pollers/tinygs.py` to:
    - detect TLS certificate verification failures and emit a one-time actionable error message,
    - support `TINYGS_CA_CERT_PATH` for loading a TinyGS-specific PEM bundle,
    - support opt-in `TINYGS_TLS_INSECURE=true` as a last-resort bypass for private/self-signed deployments,
    - back off reconnect attempts exponentially from 15s up to 300s so permanent TLS failures do not keep hammering the broker or waste CPU.
- **Config surface**: Added `tinygs_ca_cert_path` and `tinygs_tls_insecure` to `poller/config.py` and documented both env vars in `.env.example`.
- **Validation**: `python -m py_compile poller/config.py poller/pollers/tinygs.py` ✓

## 2026-05-03 — Sprint 6: Map Annotations (E1) + UX Refinement

- **E1 — Map Annotations (backend)**: Added `Annotation` DB model to `backend/db/models.py` (annotation_type, label, color, geojson JSON, created_by, expires_at). Created `db/init/05_annotations.sql` migration. Created `backend/routers/annotations.py` with `GET/POST/DELETE /api/v1/annotations`; GET auto-filters expired annotations. Registered router in `backend/main.py`.
- **E1 — Map Annotations (frontend types + store)**: Added `AnnotationItem` interface to `frontend/src/storeTypes.ts`. Added `annotations[]`, `annotationDrawMode`, `annotationsVisible` slice with actions to `frontend/src/store.ts`.
- **E1 — AnnotationOverlay component**: Created `frontend/src/components/layers/AnnotationOverlay.tsx` — a self-contained component that manages MapLibre GeoJSON sources (`annotations-source`, `annotation-draw-source`) and layers (fill, line, marker circle, symbol label), handles draw interaction (click-to-add points, dblclick-to-finish, live rubber-band mousemove preview), shows a save form modal (label, color presets, expiry: 4h/12h/24h/permanent), shows a delete popup on clicking existing annotations, and includes a floating bottom-center toolbar with visibility toggle + draw mode buttons.
- **E1 — Map integration**: Imported and mounted `<AnnotationOverlay map={map} />` in `frontend/src/components/Map.tsx`. Added `annotationDrawModeRef` to `frontend/src/components/MapOverlay.tsx` with a guard in `onMapClick` to skip entity selection while annotation draw mode is active.
- **UX refinements**: Replaced blank auth-check screen in `App.tsx` with a centered spinner. Normalized empty state styling for incidents and news in `Sidebar.tsx` (consistent italic/dimmed text). Added "No tags assigned" empty state placeholder in `EntityDetail.tsx` mission tags section. Upgraded "No matches" state in `EntitySearchPanel.tsx` with a `search_off` icon and centered layout.
- **Roadmap**: Marked E1 Done, Sprint 6 Complete in `ROADMAP.md`. Moved F1 (ATAK CoT Ingest) to Sprint 7 scope.
- **Validation**: `npx tsc --noEmit` ✓ zero errors · `docker compose config --quiet` ✓ · `python3 -m py_compile` ✓ all modified Python files.
- **Motivation**: Sprint 6 delivers E1 Map Annotation Tools — operators can now draw markers, lines, and areas directly on the map with labels, color coding, and auto-expiry for tactical incident management and shift briefings.

---

## 2026-05-03 — Sprint 5: Entity Tagging, Alert Suppression, Snapshot Export (E3/E4/E5)

- **E3 — Entity Mission Tags (backend)**: Added `EntityMissionTag` DB model to `backend/db/models.py` and new CRUD router at `GET/POST/DELETE /api/v1/entities/{id}/tags` in `backend/routers/entity_tags.py`. Registered router in `backend/main.py`. Added `db/init/04_entity_mission_tags.sql` migration (creates `entity_mission_tags` table and adds cooldown columns to `alert_rules`).
- **E3 — Entity Mission Tags (frontend)**: Added `EntityMissionTag` interface to `frontend/src/storeTypes.ts`. Added `entityMissionTags` store slice with `setEntityMissionTags`, `addEntityMissionTag`, `removeEntityMissionTag` actions to `frontend/src/store.ts`. Updated `EntityDetail.tsx` with a full tag editor: fetch tags on entity select, color-coded tag chips with delete, new-tag form with 7 color presets. Updated `EntitySearchPanel.tsx` with a "Tagged Only" filter toggle and colored dot indicators on tagged entities in the list.
- **E3 — Map color override**: Updated `frontend/src/layers/buildEntityLayers.ts` to accept optional `tagColorMap?: Record<string, [number,number,number,number]>` and apply it as the icon color when present. Updated `frontend/src/components/MapOverlay.tsx` to compute a `missionTagsRef` from the store and pass it to `buildEntityLayers` on each RAF tick.
- **E4 — Alert Suppression / Cooldown Rules (backend)**: Extended `AlertRule` model in `backend/db/models.py` with `cooldown_seconds`, `max_per_hour`, `dedup_key` columns. Updated `backend/routers/alertrules.py` Create/Update/Response schemas with the new fields. Rewrote `backend/webhook_dispatcher.py` to call `_is_suppressed()` before each dispatch; uses Redis keys `alertrule:{id}:{dedup_val}:cd` (cooldown lock) and `alertrule:{id}:{dedup_val}:h` (hourly counter) to suppress repeat fires.
- **E4 — Alert Suppression (frontend)**: Added "Suppression settings" expandable section in `frontend/src/components/layout/AlertRulesSection.tsx` with cooldown (seconds) and max-per-hour inputs. Existing rule list rows now display cooldown/rate indicators when set.
- **E5 — Dashboard Snapshot Export**: Created `frontend/src/snapshotExport.ts` utility that composites the MapLibre GL canvas (`.maplibregl-canvas`) with the Deck.gl overlay canvas (`#deck-overlay-canvas`) and triggers a PNG download. Added `id="deck-overlay-canvas"` to the Deck canvas in `MapOverlay.tsx`. Enabled `preserveDrawingBuffer: true` in `Map.tsx` so the WebGL canvas remains readable after frame render. Added `photo_camera` icon button to `frontend/src/components/layout/Header.tsx` that calls the export utility.
- **Roadmap**: Marked E3, E4, E5 as Done in `ROADMAP.md`; marked Sprint 5 complete.
- **Validation**: `npx tsc --noEmit` ✓ zero errors · `docker compose config --quiet` ✓ · `python3 -m py_compile` ✓ all modified Python files.
- **Motivation**: Completed all three Sprint 5 tactical quick-win items, advancing operator ergonomics with mission-aware entity grouping, alert noise control, and one-click situational snapshots.

---

## 2026-05-02 — Incident Interface Stabilization & Traffic Gating

- **Traffic Incident Noise Reduction**: Implemented a dual-radius filtering strategy in `incidentUtils.ts`. Major incidents (detected via keywords like 'crash', 'closure', 'blocked') are surfaced within a 15km radius, while minor traffic events are capped at 8km (5 miles) to eliminate background noise.
- **Incidents Panel Overhaul**: Migrated the AI Situational Briefing to the primary header position for immediate context. Restored distance-based gating to the "Filtered Minor Incidents" section, ensuring only hyper-local low-impact events are shown.
- **Infrastructure Grid Redesign**: Converted the `InfrastructureGrid` to a full-width 2-column layout. This accommodates high-density camera feeds, bookmarking support, and the regional traffic incident monitor with improved readability.
- **Module & Build Stability**: Resolved intermittent Babel parsing errors caused by malformed JSX comments in `Sidebar.tsx`. Standardized import paths and synchronized the `TrafficIncident` interface across the store and utility layers to fix module resolution failures.
- **UX & Navigation**: Promoted the "Incidents" tab to the second position in the global navigation (`Header.tsx`, `MobileNav.tsx`) for better logical flow during active operations.

---

## 2026-05-02 — Added Geospatial Event Mapping (Seismic)

- **Frontend `SystemEvent` Type**: Upgraded `frontend/src/store.ts` so the `details` field explicitly types `lat`, `lon`, and `magnitude`.
- **New `buildEventLayers.ts`**: Created a Deck.gl `ScatterplotLayer` that filters the live `systemEvents` feed for entries with coordinates. Events are drawn with semantic colors by severity, scaled by magnitude, and dynamically fade in opacity over a 24-hour window.
- **Map Integration & Tooltips**: Injected `buildEventLayers` into the `MapOverlay.tsx` render loop. Added hover picking support so clicking/hovering a seismic event on the map displays a customized popover showing its summary, severity, and relative age.
- **Seismic Gating**: Added haversine distance filtering to `poller/pollers/seismic.py`. Local events (< 300km) are ingested regardless of magnitude. Regional events (< 1500km) require magnitude >= 3.0. Global events require magnitude >= 5.0.
- **UI Tweaks**: Added `flex-wrap` to `EntitySearchPanel.tsx` to prevent entity type filter buttons from overflowing the container.
- **Tooling**: Added a root `Makefile` to simplify starting the project (`make dev`, `make prod`, `make build`, etc.).
- **Validation**: Passed strict type checking `npx tsc --noEmit`.

---

## 2026-05-02 — Metrics dashboard overhaul — all 10 improvements implemented

- **Poller heartbeat system**: Modified `poller/pollers/base.py` to write a heartbeat (`ts`, `status`, `last_error`) to `metrics:poller_heartbeats` Redis hash after every poll cycle (success or error), enabling live visibility into all 13 pollers.
- **Wider metrics history**: Expanded `backend/metrics_collector.py` from 36 → 360 snapshots (6 min → 60 min rolling window). Added `ws_client_count` module-level counter and WS client helpers.
- **WebSocket client counter**: Updated `backend/routers/ws.py` to call `ws_client_connect()` / `ws_client_disconnect()` on every WS session lifecycle, tracking live client count in real time.
- **Extended `/admin/metrics`**: Now returns `ws_clients`, `db_ping_ms`, `redis_ping_ms` on each call; history points include `cpu_pct` and `ws_clients`.
- **Extended `/admin/storage`**: Added `table_size_bytes` (pg_total_relation_size), `obs_per_day_7d` (7-day rolling average), `event_count`, `event_type_counts`.
- **New `GET /admin/pollers`**: Reads heartbeat hash from Redis, computes staleness based on each poller's configured interval (dynamic threshold + 60s grace period), returns per-poller status (ok/stale/error).
- **New `GET /admin/ingestion-rate`**: Bucketed SQL query (date_trunc minute × entity_type × count) returning 60-min observation rate data.
- **New `GET /admin/db-pool`**: Introspects SQLAlchemy `QueuePool` for `pool_size`, `checked_in`, `checked_out`, `overflow`.
- **Frontend — modular component split**: Replaced monolithic `AdminMetrics.tsx` with 9 focused files under `frontend/src/admin/metrics/`:
  - `types.ts` — shared TypeScript types
  - `Primitives.tsx` — reusable `AreaSparkline` (SVG gradient fill) and `MetricCard`
  - `HealthBar.tsx` — system health pill strip (DB, Redis, Pollers aggregate, WS count)
  - `LivePerformance.tsx` — 6 metric cards with 60-min area sparklines (req/s, error%, P95, memory, CPU, WS clients)
  - `PollerGrid.tsx` — 13-cell responsive grid with LIVE/STALE/ERR pills and relative timestamps
  - `IngestionChart.tsx` — multi-line SVG chart with semantic signal colors (cyan=aircraft, green=vessel, amber=aprs/p25)
  - `EntityDonut.tsx` — pure SVG donut chart + count cards per entity type
  - `EventActivity.tsx` — event type breakdown with severity-coded indicators
  - `StoragePanel.tsx` — table size, daily growth rate, days-until-purge projection, retention slider
  - `DbPoolPanel.tsx` — 4 pool stat cards with utilization warning
  - `AdminMetrics.tsx` — slim orchestrator wiring all components, 15s fast refresh + 60s slow refresh
- **Validation**: `npx tsc --noEmit` ✓ zero errors · `python -m py_compile` ✓ all modified files · `docker compose config --quiet` ✓ · `docker compose up -d --build` ✓ all containers healthy

---

## 2026-05-02 — Implemented Sprint 3: talkgroup management, SitRep export, KML import, Grafana

- **C4 P25 Talkgroup Management**: Added `Talkgroup` DB model (`tgid`, `name`, `priority` 1–5, `color`, `scan_enabled`) to `backend/db/models.py`.
- **C4**: Added CRUD endpoints at `GET/POST/PUT/DELETE /api/v1/radio/talkgroups` in `backend/routers/radio.py`.
- **C4**: Overhauled the talkgroups tab in `frontend/src/components/panels/TacticalAudio.tsx` — inline name editing (click-to-rename), color-coded priority badge (P1–P5) with dropdown selector, scan toggle, auto-register button for TGIDs seen in the 24h call log, and delete.
- **B4 SitRep Export**: New `backend/routers/sitrep.py` — `GET /api/v1/sitrep?hours=N` aggregates entity counts by type, recent events, weather alerts from Redis, and the AI summary into a downloadable Markdown situation report.
- **B4**: Added "SitRep" button to `frontend/src/components/panels/EventLogPanel.tsx` header — opens a time-window selector (6h / 12h / 24h / 48h / 72h) and triggers a direct `.md` file download via Blob URL.
- **D3 KML/GeoJSON Import**: Added `CustomLayer` DB model (`name`, `geojson`, `style`, `visible`) to `backend/db/models.py`; new CRUD router at `GET/POST/PUT/DELETE /api/v1/layers` in `backend/routers/layers.py`.
- **D3**: Rewrote `frontend/src/components/panels/GeofencePanel.tsx` with a tabbed layout (Geofences / Custom Layers); the Custom Layers tab has a drag-and-drop file drop zone accepting `.kml`, `.geojson`, `.json`, a browser-side KML→GeoJSON converter using `DOMParser` (no npm dependency), layer name form, visibility toggle, and delete.
- **D3**: New `frontend/src/components/layers/CustomLayersLayer.tsx` — renders each visible `CustomLayer` as MapLibre `fill` + `line` + `circle` sub-layers; polls the API every 30s and syncs to the Zustand store; mounted in `frontend/src/components/Map.tsx`.
- **D3**: Added `CustomLayerItem` type and `customLayers`/`setCustomLayers` to `frontend/src/store.ts`.
- **D5 Grafana Dashboard**: Added `prometheus` and `grafana` services to `docker-compose.yml` under `--profile monitoring` (Prometheus `:9090`, Grafana `:3001`).
- **D5**: Created `infra/prometheus/prometheus.yml` (scrapes backend `/metrics` every 15s); `infra/grafana/provisioning/` with auto-provisioned Prometheus datasource and dashboard loader; `infra/grafana/dashboards/vertex.json` pre-built dashboard covering request rate, error rate, p50/p95/p99 latency, CPU, and memory.
- Registered `sitrep` and `layers` routers in `backend/main.py`.
- All checks passed: `npx tsc --noEmit`, `docker compose config --quiet`, `python3 -m py_compile` on all modified `.py` files.
- **Motivation**: Completed all four Sprint 3 (Depth & Refinement) roadmap items — C4, B4, D3, D5 — advancing Vertex from a passive display to an operator-configurable platform with radio identity management, exportable documentation, flexible map overlays, and production observability.

---

## 2026-04-30 — Split documentation into a dedicated docs tree

- Added a new documentation hub at [docs/README.md](docs/README.md) to keep long-form project documentation out of the top-level README.
- Added focused guides for:
    - [docs/getting-started.md](docs/getting-started.md)
    - [docs/architecture/overview.md](docs/architecture/overview.md)
    - [docs/features/overview.md](docs/features/overview.md)
    - [docs/configuration/environment.md](docs/configuration/environment.md)
    - [docs/configuration/sources.md](docs/configuration/sources.md)
- Reduced [README.md](README.md) to a concise project overview with links into the new docs structure.
- Validation:
    - Markdown diagnostics on the touched documentation files reported no errors

## 2026-04-30 — Added region-aware wildfire relevance and environment panel fire status

- Updated [poller/pollers/fire.py](poller/pollers/fire.py) to classify wildfires as `local` or `regional` using the configured bbox, alert radius, and regional radius.
- Added freshness gating for regional wildfire retention in [poller/pollers/fire.py](poller/pollers/fire.py) so stale distant fires do not linger in the awareness feed.
- Added new wildfire relevance settings in [poller/config.py](poller/config.py) and documented them in [.env.example](.env.example).
- Added a new fire/smoke section in [frontend/src/components/panels/EnvironmentPanel.tsx](frontend/src/components/panels/EnvironmentPanel.tsx) showing:
    - local alertable fires
    - regional wildfire watch items
    - AQI-linked smoke impact context
- Validation:
    - `python -m py_compile poller/config.py poller/pollers/fire.py` passed
    - `cd frontend && npx tsc --noEmit` passed

## 2026-04-30 — Completed Sprint 2 (B1, C3, A1, A2)

- **B1 Outbound webhooks / alerting rules**
    - Added `AlertRule` model in [backend/db/models.py](backend/db/models.py).
    - Added CRUD API at [backend/routers/alertrules.py](backend/routers/alertrules.py) and registered router in [backend/main.py](backend/main.py).
    - Added websocket-driven dispatcher in [backend/webhook_dispatcher.py](backend/webhook_dispatcher.py) to evaluate matching rules and execute webhook/log actions.
    - Added admin UI section in [frontend/src/components/layout/SettingsPanel.tsx](frontend/src/components/layout/SettingsPanel.tsx) for create/toggle/delete.

- **C3 Geofence circles + dwell conditions**
    - Extended geofence schema/model with `geofence_shape`, `center_lat`, `center_lon`, `radius_m`, `dwell_seconds` in [backend/db/models.py](backend/db/models.py) and [db/init/01_schema.sql](db/init/01_schema.sql).
    - Implemented circle and dwell-capable payload handling in [backend/routers/geofences.py](backend/routers/geofences.py).
    - Implemented dwell-gated geofence transitions in [poller/geofence.py](poller/geofence.py): emits entry only after dwell threshold; exit emitted only after entry was emitted.
    - Added frontend circle draw workflow + dwell input in [frontend/src/components/panels/GeofencePanel.tsx](frontend/src/components/panels/GeofencePanel.tsx) and preview rendering in [frontend/src/components/layers/GeofenceLayer.tsx](frontend/src/components/layers/GeofenceLayer.tsx).

- **A1 Fire/smoke overlays**
    - Added wildfire ingest poller [poller/pollers/fire.py](poller/pollers/fire.py) (EONET feed) and wired into [poller/main.py](poller/main.py).
    - Fire entities now publish as `entity_type=fire_incident` and render in map overlay stack.
    - Added smoke raster WMS overlay layer [frontend/src/components/layers/SmokeLayer.tsx](frontend/src/components/layers/SmokeLayer.tsx), wired into [frontend/src/components/Map.tsx](frontend/src/components/Map.tsx), with toggle in [frontend/src/components/layout/SettingsPanel.tsx](frontend/src/components/layout/SettingsPanel.tsx).

- **A2 APRS/HAM tracking**
    - Added APRS-IS stream poller [poller/pollers/aprs.py](poller/pollers/aprs.py), wired into [poller/main.py](poller/main.py), with settings in [poller/config.py](poller/config.py).
    - Added source type support for `fire` and `aprs` in [poller/config_loader.py](poller/config_loader.py), [backend/config_loader.py](backend/config_loader.py), and [backend/routers/sources.py](backend/routers/sources.py).
    - Added default source examples in [config/sources.yml](config/sources.yml) and [config/sources.example.yml](config/sources.example.yml).
    - Frontend rendering updated for APRS/fire entity tracks and APRS labels in [frontend/src/layers/buildEntityLayers.ts](frontend/src/layers/buildEntityLayers.ts), [frontend/src/layers/iconAtlas.ts](frontend/src/layers/iconAtlas.ts), [frontend/src/layers/colorUtils.ts](frontend/src/layers/colorUtils.ts), [frontend/src/components/MapOverlay.tsx](frontend/src/components/MapOverlay.tsx), [frontend/src/components/panels/EntitySearchPanel.tsx](frontend/src/components/panels/EntitySearchPanel.tsx), and [frontend/src/store.ts](frontend/src/store.ts).

- **Roadmap tracking updated**
    - Marked Sprint 2 items (`B1`, `C3`, `A1`, `A2`) as **Done** and updated Sprint 2 validation evidence in [ROADMAP.md](ROADMAP.md).

- **Validation**
    - `cd frontend && npx tsc --noEmit` passed


## 2026-05-05 — Migrated Mesh/TinyGS overlays to Deck + documented map-layer architecture

- **Deck migration**:
    - Added Deck mesh node builder: `frontend/src/layers/buildMeshNodeLayer.ts`.
    - Added Deck TinyGS builder: `frontend/src/layers/buildTinyGSLayer.ts`.
    - Wired both into `frontend/src/components/MapOverlay.tsx` with hover tooltip + click selection support.
    - Removed legacy MapLibre mounts for mesh/tinygs from `frontend/src/components/Map.tsx`.
- **Declutter tuning**:
    - Reduced stream gauge marker footprint in `frontend/src/layers/buildStreamGaugeLayer.ts`.
- **Architecture policy/docs**:
    - Added mandatory map rendering rules to `Agents.md` (Deck for operational indicators, MapLibre for basemap/raster/terrain).
    - Added current-state design artifact: `research/map-layer-architecture-current-state-2026-05-05.md`.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓
    - `docker compose up -d --build frontend` ✓
## 2026-05-05 — Decluttered dense map presentation (gauges + APRS labels)

- **Stream gauge declutter**: Removed always-on stream gauge text labels from Deck rendering in `frontend/src/layers/buildStreamGaugeLayer.ts`.
- **APRS declutter**: Added zoom gating so APRS callsign labels only render at close zoom (`zoom >= 10`) in `frontend/src/layers/buildEntityLayers.ts`.
- **Overlay wiring**: Passed map zoom into entity layer builder from `frontend/src/components/MapOverlay.tsx`.
- **Validation**:
    - `cd frontend && npx tsc --noEmit` ✓
    - `docker compose up -d --build frontend` ✓
    - `python -m py_compile` on all touched backend/poller Python files passed
    - `docker compose config --quiet` passed
    - `docker compose up -d --build backend poller frontend` passed (services started)
    - Follow-up backend init hardening in [backend/db/session.py](backend/db/session.py) to tolerate multi-worker startup DDL race on `alert_rules` sequence; backend redeploy succeeded

## 2026-04-30 — Sprint 2 kickoff and roadmap validation tracker

- Updated [ROADMAP.md](ROADMAP.md) to start Sprint 2 tracking with explicit validation gates.
- Marked `B1` (Outbound webhooks / alerting rules) as **In Progress** as the active Sprint 2 work item.
- Added a new "Sprint 2 Progress Tracker (Validation)" table covering `B1`, `C3`, `A1`, and `A2` with status and evidence columns for release validation.

## 2026-04-30 — Marked Sprint 1 small-effort roadmap items complete and added live seismic event push

- Updated [ROADMAP.md](ROADMAP.md) statuses for completed items: `A3`, `C1`, `C2`, `C5`, `C6`, and `D2` are now **Done** in both item sections and the tracking table.
- Updated roadmap consistency details in [ROADMAP.md](ROADMAP.md): baseline now lists 10 pollers (including seismic), and Sprint 3 no longer lists already-completed `C2`.
- Added live seismic publish path in [poller/pollers/seismic.py](poller/pollers/seismic.py): after persisting each seismic event, poller now emits a Redis pub/sub `{"type":"event"}` payload to `civic:updates`.
- Updated [frontend/src/components/panels/EnvironmentPanel.tsx](frontend/src/components/panels/EnvironmentPanel.tsx) to merge websocket-delivered seismic events with polled 24-hour history, so the seismic card updates immediately while retaining historical context.
- Validation:
    - `cd frontend && npx tsc --noEmit` passed
    - `python -m py_compile poller/pollers/seismic.py` passed
    - `docker compose config --quiet` passed

## 2026-04-30 — Phase 1 Item 1: Bounded enrichment worker pool

- **Problem**: Three `asyncio.create_task()` fire-and-forget calls in `_enrich_aircraft_cache_only()` (route lookup, aircraft lookup, METAR fetch) were unsupervised — exceptions were silently swallowed and tasks could accumulate unboundedly under high traffic.
- **Solution** in [poller/pollers/adsb.py](poller/pollers/adsb.py):
  - Added `_enrichment_queue: asyncio.Queue` (maxsize=256) to `__init__`
  - Added `_enrichment_worker_loop()` — serial drain loop that awaits each queued coroutine and logs exceptions
  - Added `_schedule_enrichment(coro)` — `put_nowait` with graceful drop: calls `coro.close()` and logs a warning if queue is full
  - Updated `_ensure_registry_tasks()` to spawn and supervise `_enrichment_worker_task`
  - Updated `close()` to cancel/join `_enrichment_worker_task`
  - Replaced all three `asyncio.create_task(...)` enrichment calls with `self._schedule_enrichment(...)`
- **Behavior**: Enrichment requests are now bounded (max 256 queued), failures are logged, and the worker task restarts if it crashes (via `_ensure_registry_tasks` being called each poll cycle)
- **Validation**: `python -m py_compile poller/pollers/adsb.py` ✓ passed
- **Gap analysis doc**: Updated Phase 0 & Phase 1 sections to mark all completed items ✅

## 2026-04-30 — Implemented Phase 0.4 & Phase 1.2/1.4: BEAST health metrics, task teardown, expanded change-detection

**Phase 0 Item 4: BEAST Health Snapshot Fields**
- Added three new metrics to the `aircraft_snapshot` envelope:
  - `beast_connected` (bool): Whether the BEAST TCP task is running and not done
  - `queue_depth` (int): Current size of the registry work queue (max 16384)
  - `last_frame_age_s` (float | null): Seconds since last successful BEAST frame decode
- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py):
  - Added `_beast_last_frame_ts` tracking field in `__init__`
  - Updated frame ingest path to store `time.time()` on successful entity decode
  - Modified `_publish_aircraft_snapshot()` to compute metrics and include in snapshot envelope
- **Validation**: Passed Python syntax check on `poller/pollers/adsb.py`

**Phase 1 Item 4: Explicit Task Teardown Control**
- Added graceful shutdown path for BEAST background tasks:
  - New `close()` method in [poller/pollers/adsb.py](poller/pollers/adsb.py) to cancel/join `_beast_task`, `_registry_worker_task`, `_registry_tick_task`
  - Modified [poller/pollers/base.py](poller/pollers/base.py) `run()` method with try/finally block to invoke `close()` on shutdown
- **Rationale**: Background BEAST consumer task, registry worker, and 1 Hz ticker need explicit cleanup to avoid resource leaks or hung processes during graceful shutdown
- **Validation**: Passed Python syntax check on `poller/pollers/base.py`

**Phase 1 Item 2: Expanded Change-Detection Field Comparison**
- Updated [poller/bus.py](poller/bus.py) `_entity_changed()` function to include BEAST-evolving fields in the comparison key set:
  - Added: `position_stale`, `signal_peak`, `msg_count`, `mlat_ticks`, `trail_pts`, `comm_b`
  - Rationale: These fields represent meaningful state transitions (signal strength, staleness, trail updates, Comm-B presence) and should trigger entity_update publishes on the civic:updates channel
- **Impact**: Frontend entity updates now reflect BEAST signal/trail evolution in addition to core positional state
- **Validation**: Passed Python syntax check on `poller/bus.py`

**Cross-Validation**:
- `cd frontend && npx tsc --noEmit` ✓ passed (no TypeScript errors)
- `docker compose config --quiet` ✓ passed (valid YAML)
- `python -m py_compile poller/pollers/adsb.py poller/pollers/base.py poller/bus.py` ✓ passed

## 2026-04-30 — Fixed BEAST freshness timestamp semantics, empty-snapshot behavior, and doc drift

- Updated [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py) `_to_entity()` to emit `last_seen` from aircraft message time (`ac.last_seen_ts`) instead of serialization time, preserving correct freshness semantics.
- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) HTTP ingest paths (`_poll_ultrafeeder`, `_poll_opensky`) to always publish aircraft snapshots, including empty lists, preventing stale aircraft from lingering in Redis/frontend during temporary zero-aircraft upstream responses.
- Updated [research/beast-update-implimentation-tracker.md](research/beast-update-implimentation-tracker.md) to remove contradictory architecture statements and refresh completion/status wording.
- Updated [README.md](README.md) to align history retention wording with `ADSB_HISTORY_MODE` behavior.
- Validation:
    - `cd frontend && npx tsc --noEmit` passed
    - `docker compose config --quiet` passed
    - `python -m py_compile poller/normalizers/beast_decoder.py poller/pollers/adsb.py` passed

## 2026-04-30 — Completed BEAST ingress/rendering audit and gap analysis documentation

- Performed a full implementation-vs-plan audit across BEAST ingest, decode, snapshot transport, and frontend trail rendering paths.
- Added [research/beast-ingress-rendering-gap-analysis-2026-04-30.md](research/beast-ingress-rendering-gap-analysis-2026-04-30.md), including:
    - architecture parity matrix against [research/beast-ultrafeeder-research.md](research/beast-ultrafeeder-research.md)
    - severity-ranked bug/risk findings with file-level evidence
    - gap inventory and phased remediation roadmap
    - validation checklist for follow-up implementation work
- Key audit findings documented:
    - BEAST `last_seen` timestamp semantics are currently inaccurate for freshness consumers
    - HTTP poll path can retain stale aircraft snapshots when upstream returns zero aircraft
    - change-only publish comparison omits several BEAST-evolving fields
    - enrichment fire-and-forget tasks and task lifecycle supervision can be hardened
    - tracker/README documentation drift and contradictions need cleanup

## 2026-04-30 — Removed dead-reckoning from BEAST display position (floating trail fix)

- Root cause: `_to_entity()` in `beast_decoder.py` projected the display position forward using heading+speed whenever a CPR fix was >1.5 s old. This caused the entity icon to drift away from the actual CPR-fixed positions in `pos_history`, splitting the icon and trail to different geographic coordinates. The trail endpoint and icon endpoint rotated relative to each other as the map was panned (classic geographic coordinate divergence rendered at different positions).
- **Fix**: Removed the dead-reckoning projection block entirely from `_to_entity()`. The entity always renders at `ac.lat / ac.lon` (last actual CPR fix). `position_stale` is now set when the last fix is >10 s old (threshold raised from 1.5 s to match display utility).
- **Rationale**: The frontend already renders a dashed predicted-path layer extrapolated from current heading/speed — this covers the "smooth motion" UX need. Backend dead-reckoning only introduced the icon-trail split.
- `_project_position()` helper is retained in the module (may be used for other purposes in future).
- Validation:
    - `python -m py_compile poller/normalizers/beast_decoder.py` passed
    - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build poller` built and started successfully

## 2026-04-30 — Fixed ghost trail and cross-map gap bridge from BEAST tracking loss

- Root cause: when BEAST loses and reacquires an aircraft, `pos_history` accumulates positions from both sessions. The old session appears as a disconnected "ghost trail" far from the current icon, and the gap bridge drew a straight line across the map to connect them.
- **`store.ts` — tracking-gap segmentation**: In the `trail_pts` conversion path, scan consecutive timestamps for gaps >30 s. If found, only use points from the most recent continuous segment (`segmentStart = i` on gap). This makes the history trail always anchored to the current icon position.
- **`buildTrailLayers.ts` — gap bridge cap**: Added `MAX_GAP_BRIDGE_M = 5 000 m`. The bridge only fires when the smoothed trail endpoint is 5 m–5 km from the live icon (the normal Chaikin smoothing offset). Distances >5 km are a tracking-loss gap and are silently suppressed — no more cross-map lines.
- Validation:
    - `node node_modules/typescript/bin/tsc --noEmit` passed (zero errors)
    - `docker compose up -d --build frontend` — built and started successfully

## 2026-04-30 — Fixed CPR decode "hook" artifacts in BEAST flight trails

- Root cause: Tier-2/3 local CPR decodes occasionally resolve a position in the right CPR zone but the wrong cell, producing a "hook" — the trail veers off-course and snaps back. The teleport guard (10 km budget) was not tight enough to catch these because the bad cell can be within 10 km of the true position.
- **Backend fix** (`poller/normalizers/beast_decoder.py`): Added a heading-consistency guard in `_update_cpr()`. After the teleport guard, if the aircraft has a known heading and speed >50 kts, the bearing from the current position to the candidate is computed using a new `_bearing_deg()` helper. Candidates where the required bearing differs from the known heading by >90° are rejected as bad CPR decodes.
- Added `_bearing_deg(lat1, lon1, lat2, lon2)` module-level helper (rhumb-line bearing, 0–360°).
- **Frontend safety-net** (`frontend/src/layers/geoUtils.ts`): Added `filterTrailSpikes(pts, maxAngleDeg=120)`. Iterates the trail and removes any point where the inbound and outbound bearing differ by more than maxAngleDeg — a spike signature no real aircraft can produce. Returns the cleaned point list.
- **Frontend wiring** (`frontend/src/store.ts`): Import and apply `filterTrailSpikes` on the raw trail coordinates before passing to `chaikinSmooth`. Pipeline is now: `trail_pts → filterTrailSpikes → chaikinSmooth`.
- Validation:
    - `python -m py_compile poller/normalizers/beast_decoder.py` passed
    - `node node_modules/typescript/bin/tsc --noEmit` passed (zero errors)
    - `docker compose up -d --build poller frontend` — all containers built and started

## 2026-04-30 — Fixed jagged BEAST flight trails with server-side position ring buffer

- Root-cause: `_AircraftState` in `beast_decoder.py` stored only the current position, so the frontend trail accumulated at most 1 point/second — too sparse for smooth rendering.
- Added `pos_history: deque` (maxlen=150) to `_AircraftState`; populated on every successful CPR position resolve in `_update_cpr()`.
- Each entry is `(lat, lon, alt_ft, unix_ts)` — compact tuple matching the frontend `TRAIL_CAP` constant.
- Extended `_to_entity()` to serialise the ring buffer as `trail_pts: [[lat, lon, alt_ft, ts], ...]` in every emitted entity dict (both live entity_update events and 1 Hz snapshots).
- Updated `frontend/src/store.ts` `Entity` interface with `trail_pts?: [number, number, number, number][]`.
- Refactored `entityToTrack()` to prefer the server trail when `trail_pts` is present and larger than the client's accumulated trail, converting `[lat, lon, alt_ft, unix_ts]` → `TrailPt [lon, lat, altM, speedMs, ts]`. Falls back to client-side accumulation for non-BEAST sources.
- Net effect: BEAST trails immediately have dense, closely-spaced points on load; Chaikin smoothing operates on a high-density input → smooth curves matching FlightJar quality.
- Validation:
    - `python -m py_compile poller/normalizers/beast_decoder.py poller/pollers/adsb.py` passed
    - `node node_modules/typescript/bin/tsc --noEmit` passed (zero errors)
    - `docker compose up -d --build poller frontend` — both containers built and started successfully

## 2026-04-29 — Fixed ODOT incidents schema drift causing blank incident cards

- Diagnosed live `feed:traffic:incidents` payload in Redis and confirmed 132 records with empty title/description/location due to upstream schema drift.
- Updated [poller/pollers/traffic.py](poller/pollers/traffic.py) incident parser to support current ODOT TripCheck structure:
    - uses nested hyphenated keys (`headline`, `comments`, `impact-desc`, `is-active`)
    - reads nested location coordinates from `location.start-location.start-lat/start-long` with fallback
    - filters inactive incidents and out-of-bbox incidents
    - emits normalized `title`, `description`, `location`, `lat`, `lon`, `severity`, `pubDate`.
- Verified live Redis feed now contains meaningful data (49 incidents in-region with populated title/location/coords).
- Added frontend resilience for generic labels:
    - [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx)
    - [frontend/src/components/panels/InfrastructureGrid.tsx](frontend/src/components/panels/InfrastructureGrid.tsx)
  Both now derive a location-aware title when upstream title is generic.
- Validation and deploy:
    - `python -m py_compile poller/pollers/traffic.py` passed
    - `cd frontend && npx tsc --noEmit` passed
    - `docker compose up -d --build poller` completed
    - `docker compose up -d --build frontend` completed

## 2026-04-29 — Scoped traffic incidents to region bbox and surfaced incident location in UI

- Updated [poller/pollers/traffic.py](poller/pollers/traffic.py) incident normalization to filter ODOT incidents by configured region bbox (`bbox_min/max_lat/lon`) when coordinates are present, preventing statewide spillover in local dashboards.
- Added explicit `location` field to normalized traffic incidents from ODOT `locationDescription` and preserved coordinate fields for map-oriented fallbacks.
- Extended incident typing in [frontend/src/store.ts](frontend/src/store.ts) with optional `location` for stronger UI rendering.
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) incident cards to display incident location (with `lat, lon` fallback when text location is unavailable).
- Updated [frontend/src/components/panels/InfrastructureGrid.tsx](frontend/src/components/panels/InfrastructureGrid.tsx) to render explicit incident location above descriptions with coordinate fallback.
- Validation:
    - `python -m py_compile poller/pollers/traffic.py` passed
    - `cd frontend && npx tsc --noEmit` passed
    - `docker compose up -d --build poller frontend` completed; `poller`, `backend`, and `frontend` are healthy/started

## 2026-04-28 — Wired full data exposure path for traffic, weather alerts, summary, events, and ADS-B enrichment UI

- Updated [poller/pollers/alerts.py](poller/pollers/alerts.py) to publish a dedicated `feed:weather:alerts` payload from NWS CAP data while preserving the combined `alerts:flash` feed.
- Extended frontend store in [frontend/src/store.ts](frontend/src/store.ts) with:
    - `trafficIncidents` state and setter
    - `summary` state and setter
    - `setSystemEvents(...)` for loading historical DB events
    - dedupe-aware `appendSystemEvent(...)`
    - additional entity fields (`vertical_rate`, `distance_km`) for enriched ADS-B display.
- Updated [frontend/src/hooks/useAlerts.ts](frontend/src/hooks/useAlerts.ts) to poll and store:
    - `/api/v1/traffic/incidents`
    - `/api/v1/summary`
    - existing weather/alerts/news/traffic/utilities feeds.
- Updated [frontend/src/hooks/useWebSocket.ts](frontend/src/hooks/useWebSocket.ts) to consume all `feed_update` keys now emitted by pollers (`weather:current`, `weather:alerts`, `alerts:flash`, `news:local`, `traffic:cameras`, `traffic:flow`, `traffic:incidents`, `summary:latest`) instead of only radio/utilities.
- Updated [frontend/src/components/panels/EventLogPanel.tsx](frontend/src/components/panels/EventLogPanel.tsx) to load `/api/v1/events` history on mount and refresh periodically, so refresh no longer loses event context.
- Updated [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx) to use real `trafficIncidents` data (with severity mapping) instead of deriving incidents from generic alerts.
- Added AI summary rendering to [frontend/src/components/panels/EnvironmentPanel.tsx](frontend/src/components/panels/EnvironmentPanel.tsx).
- Expanded ADS-B enrichment visibility in [frontend/src/components/panels/EntityDetail.tsx](frontend/src/components/panels/EntityDetail.tsx) to surface identity metadata (ICAO24, registration, operator, type, route, phase, vertical rate, distance) plus cached origin/destination METAR text when available.
- Validation:
    - `cd frontend && npx tsc --noEmit` passed
    - `docker compose config --quiet` passed
    - `python -m py_compile poller/pollers/alerts.py` passed
    - `docker compose up -d --build poller frontend` completed with healthy backend/redis/db and started poller/frontend

## 2026-04-28 — Hardened background METAR lookup task error handling

- Updated [poller/enrichment/metar.py](poller/enrichment/metar.py) `lookup_many(...)` to catch transient `httpx.HTTPError` failures (including `ReadTimeout` and upstream 5xx) and fallback to stale cache values instead of propagating exceptions.
- Added a defensive catch-all fallback in the same method so background METAR batch tasks do not emit `Task exception was never retrieved` stack traces on unexpected upstream failures.
- Kept rate-limit behavior unchanged: `UpstreamRateLimitedError` still uses stale-cache fallback semantics.
- Validation:
    - `python -m py_compile poller/enrichment/metar.py` passed
    - `docker compose restart poller` completed
    - confirmed running container includes new handler block at `lookup_many(...)`

## 2026-04-28 — Implemented single-writer BEAST work loop and Comm-B/EHS snapshot model

- Refactored [poller/pollers/adsb.py](poller/pollers/adsb.py) BEAST path to a single-writer work-queue architecture with one bounded queue (`maxsize=16384`) carrying both `frame` and `tick` work items.
- Added dedicated registry worker and 1 Hz tick producer so BEAST state mutation and snapshot emission run through a single processing loop.
- Expanded [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py) with best-effort DF4/5/11/20/21 handling and Comm-B/EHS inference for BDS 4,0 / 4,4 / 5,0 / 6,0.
- Added freshness-gated `comm_b` snapshot payload fields (including observed/derived SAT/TAT logic) and squawk/altitude reply updates from surveillance replies.
- Added local CPR decode tiers in [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py): fallback against last-known aircraft position and configured receiver reference when even/odd global CPR pairing is unavailable.
- Validation:
    - `python -m py_compile poller/pollers/adsb.py poller/normalizers/beast_decoder.py poller/enrichment/cache.py poller/enrichment/adsbdb.py poller/enrichment/metar.py poller/enrichment/aircraft_db.py poller/enrichment/airports_db.py poller/enrichment/airlines_db.py poller/enrichment/navaids_db.py poller/enrichment/route_plausibility.py poller/config.py poller/main.py` passed
    - `docker compose config --quiet` passed
    - `docker compose restart poller` completed

## 2026-04-28 — Added navaids enrichment and route plausibility filtering

- Added [poller/enrichment/navaids_db.py](poller/enrichment/navaids_db.py), a local OurAirports `navaids.csv` loader with nearest-navaid lookup support.
- Added [poller/enrichment/route_plausibility.py](poller/enrichment/route_plausibility.py) to reject obviously implausible origin/destination route assignments based on aircraft position and optional heading.
- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) to:
    - enrich `origin_info` and `dest_info` on aircraft identity from local airport metadata
    - attach nearest navaid context where available
    - drop route fields when plausibility checks fail
    - reuse enriched airport references in snapshot `airports` map
    - publish richer snapshot fields: `positioned`, `receiver`, `site_name`, `frames`
    - compute per-aircraft `distance_km` from receiver location
- Added `adsb_navaids_db_path` in [poller/config.py](poller/config.py) and documented `ADSB_NAVAIDS_DB_PATH` in [.env.example](.env.example).
- Updated [poller/Dockerfile](poller/Dockerfile) and [docker-compose.yml](docker-compose.yml) to fetch/wire `navaids.csv` (`NAVAIDS_DB_URL`) at build time.
- Validation:
    - `python -m py_compile poller/enrichment/navaids_db.py poller/enrichment/route_plausibility.py poller/pollers/adsb.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added stale-on-error and 429 cooldown handling for enrichment clients

- Updated [poller/enrichment/cache.py](poller/enrichment/cache.py) with explicit `UpstreamRateLimitedError`, stale-value fallback on fetch errors, and throttle cooldown propagation.
- Updated [poller/enrichment/adsbdb.py](poller/enrichment/adsbdb.py) to raise rate-limit exceptions on HTTP 429 (with `Retry-After` parsing), enabling shared cooldown and stale serving.
- Updated [poller/enrichment/metar.py](poller/enrichment/metar.py) to use stale values for batch lookups during 429 windows and parse `Retry-After` for cooldown.
- Validation:
    - `python -m py_compile poller/enrichment/cache.py poller/enrichment/adsbdb.py poller/enrichment/metar.py poller/enrichment/navaids_db.py poller/enrichment/route_plausibility.py poller/pollers/adsb.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added bounded BEAST frame queue with drop-oldest backpressure

- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) to decouple BEAST TCP ingest from decode/publish work using a bounded `asyncio.Queue(maxsize=16384)`.
- Added a dedicated BEAST frame worker loop (`_process_beast_frames`) so stream ingestion remains lightweight and decode/publish processing runs separately.
- Implemented drop-oldest behavior when queue is full and added `frames_dropped` snapshot metadata for visibility.
- Validation:
    - `python -m py_compile poller/pollers/adsb.py poller/enrichment/cache.py poller/enrichment/adsbdb.py poller/enrichment/metar.py poller/enrichment/navaids_db.py poller/enrichment/route_plausibility.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added stale-position dead-reckoning in BEAST snapshot output

- Updated [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py) to project stale aircraft positions forward when last position age exceeds 1.5s and heading/speed are available.
- Added `position_stale` flag in emitted aircraft entities to indicate projected versus directly observed position.
- Validation:
    - `python -m py_compile poller/normalizers/beast_decoder.py poller/pollers/adsb.py poller/enrichment/cache.py poller/enrichment/adsbdb.py poller/enrichment/metar.py poller/enrichment/navaids_db.py poller/enrichment/route_plausibility.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added OpenFlights airlines enrichment and alliance fallback

- Added [poller/enrichment/airlines_db.py](poller/enrichment/airlines_db.py), a local OpenFlights `airlines.dat` loader keyed by ICAO prefix with `lookup_by_callsign(...)` support.
- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) to enrich aircraft identity with fallback `operator`, `operator_country`, `operator_iata`, and `operator_alliance` values derived from callsign prefix when adsbdb metadata is missing.
- Added `adsb_airlines_db_path` setting in [poller/config.py](poller/config.py) and documented `ADSB_AIRLINES_DB_PATH` in [.env.example](.env.example).
- Updated [poller/Dockerfile](poller/Dockerfile) to download OpenFlights `airlines.dat` into `/data` at build time and updated [docker-compose.yml](docker-compose.yml) with `AIRLINES_DB_URL` build arg.
- Validation:
    - `python -m py_compile poller/enrichment/airlines_db.py poller/pollers/adsb.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added airports metadata enrichment and build-time data fetch wiring

- Added [poller/enrichment/airports_db.py](poller/enrichment/airports_db.py), a OurAirports CSV loader keyed by ICAO with airport metadata (`name`, `city`, `country`, `type`, `lat`, `lon`).
- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) to enrich snapshot `airports` entries from local airport DB when route origin/destination ICAO codes are known.
- Added `adsb_airports_db_path` setting in [poller/config.py](poller/config.py) and documented `ADSB_AIRPORTS_DB_PATH` in [.env.example](.env.example).
- Updated [poller/Dockerfile](poller/Dockerfile) to fetch reference data into `/data` at build time:
    - tar1090 aircraft DB (`aircraft_db.csv.gz`)
    - OurAirports dataset (`airports.csv`)
- Updated [docker-compose.yml](docker-compose.yml) poller build args for `AIRCRAFT_DB_URL`, `AIRPORTS_DB_URL`, and `DATA_CACHEBUST`.
- Validation:
    - `python -m py_compile poller/enrichment/airports_db.py poller/pollers/adsb.py poller/config.py` passed
    - `docker compose config --quiet` passed

## 2026-04-28 — Added local aircraft DB fallback enrichment

- Added [poller/enrichment/aircraft_db.py](poller/enrichment/aircraft_db.py), a tar1090-style semicolon CSV loader with gzip support and ICAO-keyed lookup.
- Wired [poller/pollers/adsb.py](poller/pollers/adsb.py) to use local aircraft DB values as fallback enrichment for `registration`, `icao_type`, and `type` when adsbdb data is missing or cold.
- Added `adsb_aircraft_db_path` setting in [poller/config.py](poller/config.py) and documented `ADSB_AIRCRAFT_DB_PATH` in [.env.example](.env.example).
- Validation: `python -m py_compile poller/enrichment/aircraft_db.py poller/pollers/adsb.py poller/config.py` passed.

## 2026-04-28 — Added batched METAR scheduling, teleport guard, and disk-backed enrichment caches

- Updated [poller/pollers/adsb.py](poller/pollers/adsb.py) to dedupe uncached callsign/ICAO fetches per snapshot and trigger one batched `lookup_many(...)` METAR request per snapshot cycle instead of one request task per airport.
- Updated [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py) with callsign normalization parity (`rstrip("_ ").strip()`) and a teleport guard (`max(10km, elapsed*0.5km/s)`) to suppress implausible CPR jump updates.
- Propagated BEAST frame metadata from parser to decoder in [poller/pollers/adsb.py](poller/pollers/adsb.py) and [poller/normalizers/beast_decoder.py](poller/normalizers/beast_decoder.py), adding per-aircraft `msg_count`, `signal_peak`, and `mlat_ticks` fields.
- Extended [poller/enrichment/cache.py](poller/enrichment/cache.py) with import/export APIs for fresh cache entries.
- Added disk-backed cache persistence wiring to [poller/enrichment/adsbdb.py](poller/enrichment/adsbdb.py) and [poller/enrichment/metar.py](poller/enrichment/metar.py), loading from `/data` on startup and saving schema-versioned gzip JSON after cache updates.
- Added `adsb_enrichment_cache_dir` in [poller/config.py](poller/config.py) for cache file location control.
- Validation: `python -m py_compile` passed for all modified poller modules.

## 2026-04-28 — Documented BEAST implementation tracker

- Added [research/beast-update-implimentation-tracker.md](c:/Projects/Vertex/research/beast-update-implimentation-tracker.md) to capture the current BEAST/Ultrafeeder refactor status against the research plan.
- Documented implemented features, partial gaps, runtime fixes, validation status, config flags, and recommended next steps so future work can resume from a single tracker file.

## 2026-04-28 — Restored aircraft trails in BEAST snapshot mode

- Identified that `aircraft_snapshot` handling in `frontend/src/hooks/useWebSocket.ts` was calling `setEntities(...)`, which replaced the full entity/track maps on every 1 Hz BEAST snapshot.
- Added `setAircraftSnapshot(...)` in `frontend/src/store.ts` to replace only the aircraft subset while preserving non-aircraft entities and existing aircraft trail history.
- Updated websocket handling to use the new merge path and verified with `npx tsc --noEmit`.

## 2026-04-28 — Hardened METAR enrichment error handling

- Updated `poller/enrichment/cache.py` to negative-cache failed enrichment fetches for the normal negative TTL window, reducing retry/log spam when an upstream response is bad.
- Updated `poller/enrichment/metar.py` to send explicit JSON headers and handle non-JSON or malformed upstream responses gracefully, with a structured warning instead of repeated raw JSON parse failures.
- Restarted `poller` and verified fresh logs show BEAST reconnecting cleanly without the prior immediate METAR warning storm.

## 2026-04-27 — Fixed BEAST-only mode gating

- Updated `poller/pollers/adsb.py` `poll()` control flow so when `ADSB_ENABLE_BEAST=true` and `ADSB_BEAST_HTTP_FALLBACK=false`, the poller runs BEAST transport only and skips HTTP/OpenSky polling entirely.
- Verified syntax with `python -m py_compile poller/pollers/adsb.py`.

## 2026-04-27 — Expanded ADS-B refactor implementation (BEAST decode + snapshot + enrichment)

- **Implement BEAST decode path**: Added `poller/normalizers/beast_decoder.py` using `pyModeS` to decode DF17/18 ADS-B messages from BEAST frames, with CPR pair handling, velocity/callsign extraction, and entity normalization.
- **Wire BEAST to live entity flow**: Updated `poller/pollers/adsb.py` to parse BEAST frame payloads, decode aircraft entities, publish live entity updates, and emit a periodic aircraft snapshot payload.
- **Add enriched aircraft snapshot transport**: Added `set_aircraft_snapshot()` in `poller/bus.py`, plus `get_aircraft_snapshot()` in `backend/redis_bus.py` and websocket bootstrap publish in `backend/routers/ws.py`.
- **Add backend aircraft snapshot endpoints**: Added `backend/routers/aircraft.py` with `/api/v1/aircraft/snapshot` and `/api/v1/aircraft/airports`, and registered router in `backend/main.py`.
- **Add frontend compatibility for snapshot payloads**: Updated `frontend/src/hooks/useWebSocket.ts` to handle `aircraft_snapshot` events and `frontend/src/store.ts` to store airports map data.
- **Add enrichment infrastructure**: Added generic cache/throttle/gzip helpers in `poller/enrichment/cache.py` and concrete clients in `poller/enrichment/adsbdb.py` and `poller/enrichment/metar.py`.
- **Integrate cache-only enrichment into snapshot path**: `poller/pollers/adsb.py` now enriches snapshot entities from cached route/aircraft/METAR data and triggers async background fetches for missing keys, plus phase classification.
- **Add change-detection publish optimization**: `poller/bus.py` now supports semantic change-only publish/write behavior controlled by `ADSB_PUBLISH_ONLY_CHANGES`.
- **Dependencies/config**:
    - Added `pyModeS==2.21.1` to `poller/requirements.txt`.
    - Added/updated ADS-B env flags in `.env.example` and `poller/config.py`.
- **Validation**:
    - Python syntax checks passed for all changed backend/poller files.
    - Frontend `npx tsc --noEmit` still reports pre-existing unrelated errors in `src/components/panels/TacticalAudio.tsx`.

## 2026-04-27 — Started ADS-B refactor implementation (phase-1 groundwork)

- **Add BEAST rollout settings**: Added new poller config flags in `poller/config.py` and documented them in `.env.example`: `ADSB_ENABLE_BEAST`, BEAST host/port/reconnect controls, HTTP fallback switch, and `ADSB_HISTORY_MODE`.
- **Introduce BEAST transport scaffold**: Refactored `poller/pollers/adsb.py` to start and supervise a BEAST TCP consumer task with reconnect backoff and frame-boundary parsing, while retaining current HTTP ultrafeeder/OpenSky ingestion for safe rollout.
- **Implement live-only persistence mode**: Updated `poller/db.py` so `ADSB_HISTORY_MODE=live_only` skips observation inserts but still upserts entity state and performs geofence checks from live positions.
- **Fix aircraft category mapping in frontend**: Updated `frontend/src/store.ts` so `Track.category` reads `identity.category` first, then falls back to `tags[0]`.
- **Validation**:
    - Python syntax compile passed for changed poller files (`poller/config.py`, `poller/pollers/adsb.py`, `poller/db.py`).
    - Frontend typecheck currently fails due pre-existing JSX typing issues in `src/components/panels/TacticalAudio.tsx` unrelated to this change set.

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
  
## 2026-05-01 - Fix Stale Radar Cache  
  
- Fixed an issue where MapLibre GL JS setTiles updated the URL template but did not clear the currently loaded tiles from the active viewport.  
- Added an explicit clearTiles() and 	riggerRepaint() call to the sourceCache to force the map to immediately fetch new imagery, preventing stale radar data. 

## 2026-05-09 — Sprint 8: Mobile-Responsive Layout (G2) + Panel Layout Persistence (G3)

### G3 — Panel Layout Persistence
- **`frontend/src/store.ts`**: Added Zustand `persist` middleware wrapping the store; `partialize` serializes 14 UI preference fields to `localStorage` key `vertex.ui.prefs` automatically.
- **`backend/db/models.py`**: Added `UserPreference` model (username, key, JSON value, updated_at) with unique index on `(username, key)` for per-user server-side preference storage.
- **`backend/routers/auth.py`**: Added `GET /auth/preferences` and `PUT /auth/preferences` endpoints; bulk upsert via INSERT … ON CONFLICT DO UPDATE.
- **`frontend/src/hooks/usePreferences.ts`**: New hook that loads preferences from backend on mount (applied to Zustand store) and debounced-saves on any store change (1.5 s delay). Wired into `App.tsx` `Dashboard` component.

### G2 — Mobile-Responsive Layout
- **`frontend/src/components/layout/MobileNav.tsx`**: Replaced full-screen slide-out drawer with a permanent `fixed bottom-0` bottom tab bar (6 tabs with icon + label, active amber stripe). No longer requires `mobileNavOpen` store state.
- **`frontend/src/components/layout/Header.tsx`**: Removed hamburger button; shows VERTEX brand mark on mobile; mode toggle buttons use icon-only below `sm` breakpoint; imported `NavTab` type.
- **`frontend/src/App.tsx`**: Root div gains `pb-14 lg:pb-0` to clear bottom nav; sidebar wrapped with `hidden lg:flex` to hide on mobile; PlaybackController row uses `left-2 lg:left-[280px]`.
- **`frontend/src/components/panels/TacticalAudio.tsx`**: Bottom position changed to `bottom-16 lg:bottom-6` to clear 56 px mobile tab bar.
- **`frontend/src/components/panels/EntitySearchPanel.tsx`**: Repositioned to `bottom-20` full-width on mobile, `top-28 left-4 w-64` on desktop (`lg:`).
- **`frontend/src/components/panels/EntityDetail.tsx`**: Width made responsive (`w-[calc(100vw-1rem)] sm:w-72 lg:w-64`); max-height capped at `55vh` on mobile.
- **Motivation**: Operators in the field using phones/tablets had no usable layout. All panels now render correctly on narrow viewports without overlap or unreachable controls.

## 2026-05-09 — Sprint 9: Production Hardening (H1, H3, I1)

### H1 — API Pagination & Filtering
- **`backend/routers/entities.py`**: Added `limit` (default 200, max 2000), `offset`, and `bbox` (min_lon,min_lat,max_lon,max_lat) query params. Bbox filtering applied in Python against Redis entity store.
- **`backend/routers/alerts.py`**: Added `limit` (default 100, max 500) and `offset` pagination on Redis-fetched alert list.
- **`backend/routers/news.py`**: Added `limit` (default 50, max 200) and `offset` pagination on Redis-fetched news list.
- **`backend/routers/events.py`**: Added `limit` (default 200, max 1000), `offset`, `event_type`, and `entity_id` filters. DB query uses `.offset().limit()`.
- **`backend/routers/observations.py`**: Added `.limit(50_000)` to replay query to prevent OOM on large time windows.

### H3 — CORS & Security Hardening
- **`backend/config.py`**: Added `cors_allow_credentials: bool = False` setting.
- **`backend/main.py`**: Passed `allow_credentials=settings.cors_allow_credentials` to `CORSMiddleware`.
- **`frontend/nginx.conf`**: Added `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, and `Referrer-Policy` security headers.
- **`backend/db/models.py`**: Added `api_key_hash` (SHA-256 hex, nullable, unique index) to `User` model.
- **`backend/db/session.py`**: Added migrations for `api_key_hash` column and its partial unique index.
- **`backend/routers/auth.py`**: Increased password `min_length` from 8 → 12 chars on setup and user creation. Added `POST /auth/apikey` (generate) and `DELETE /auth/apikey` (revoke) endpoints. `UserDetail` response now includes `has_api_key` flag.
- **`backend/auth_middleware.py`**: Added `X-API-Key` header path — SHA-256 hashes the key, looks up matching `User` row via DB, enforces admin-role check on mutating requests. JWT path unchanged as fallback.
- **`.env.example`**: Documented `CORS_ORIGINS`, `CORS_ALLOW_CREDENTIALS`, `TLS_CERT_PATH`, `TLS_KEY_PATH`.

### I1 — TLS / HTTPS Termination
- **`frontend/nginx-tls.conf`**: New Nginx config with HTTP→HTTPS redirect (port 80 → 301) and HTTPS (port 443) with TLSv1.2/1.3, HSTS, and all security headers. Mirrors `nginx.conf` proxy rules.
- **`docker-compose.tls.yml`**: Compose override that adds port 443, mounts `nginx-tls.conf` over default, and mounts cert files from `TLS_CERT_PATH` / `TLS_KEY_PATH`. Usage: `docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d`.
