# APRS & MeshCore Feature Plan

**Date:** 2026-05-15  
**Status:** In progress — Features 4 and 5 shipped

---

## Shared Infrastructure

Three foundational changes that unlock downstream features:

### 1A — Enhance `/mesh/topology` with node coordinates *(small)*
- **File:** `backend/routers/mesh.py`
- Add `?include_coords=true` query param (or new endpoint `/mesh/topology-with-coords`) that performs a Redis pipeline `GET entity:{node_id}` for each unique node and returns `[{id, lat, lon}, ...]` alongside the links array.
- **Enables:** Features 5 (already done), 6, 10

### 1B — APRS weather comment parser *(small)*
- **Create:** `poller/enrichment/aprs_weather.py` — pure function `parse_wx_comment(comment: str) -> dict | None` extracting `temp_f`, `humidity`, `pressure_mb`, `wind_mph`, `wind_dir_deg`, `rain_in` from Ultimeter/Davis-style APRS comment strings.
- **Modify:** `poller/pollers/aprs.py` — call it for `station_type == "weather"`, merge result into `identity.wx`.
- **Enables:** Feature 3

### 1C — SNR threshold alert infrastructure *(medium)*
- **Create:** `poller/mesh_link_alerts.py` — in-memory per-link SNR tracking + cooldown gate (same pattern as `geofence.py`). Writes `Event` rows and publishes to `civic:updates`.
- **DB migration:** `db/init/09_mesh_alert_config.sql` — new `mesh_alert_configs` table (`source_url`, `snr_threshold`, `cooldown_secs`, `enabled`).
- **Enables:** Feature 9

---

## Phase 2 — Map Visualizations (APRS)

### Feature 1: APRS Symbol Color-Coding *(medium)*
All data is already in the entity store — purely a frontend rendering change.

- **Create:** `frontend/src/layers/buildAprsLayers.ts` — new `IconLayer` that takes raw `Entity[]` (not `Track[]`) so `identity.station_type` is accessible.
- **Modify:** `frontend/src/components/MapOverlay.tsx` — call `buildAprsLayers()`.

Color scheme by station type:
| Type | Color |
|---|---|
| `emergency` | Red `[255, 80, 80]` + pulsing `ScatterplotLayer` ring |
| `weather` | Sky blue `[100, 200, 255]` |
| `infrastructure` | Purple `[180, 100, 255]` |
| `aircraft` | Cyan `[0, 230, 255]` |
| `marine` | Blue `[0, 120, 255]` |
| `mobile` | Existing violet `[179, 136, 255]` |
| `fixed` | Muted green `[100, 180, 100]` |

### Feature 4: APRS Trails *(small)* ✅ SHIPPED
- **Modified:** `frontend/src/hooks/useTrailHydration.ts`
- Added `APRS_HISTORY_MINUTES = 1440` (24h) and `APRS_POINT_CAP = 200`.
- Separated into two queues (`aircraftQueueRef`, `aprsQueueRef`); aircraft drains first.
- `entityTypesRef` map tracks entity type per ID so `processQueue` selects correct constants at dequeue time.
- Stale-entity pruning and 429 back-off logic preserved.

### Feature 5: Mesh Topology Link Layer Polish *(small)* ✅ SHIPPED
The `MeshLinksLayer.tsx` MapLibre layer already existed and was mounted. Two gaps closed:
- **Modified:** `frontend/src/components/layers/MeshLinksLayer.tsx`
  - `line-width` now uses `['get', 'width']` — computed as `1.5 + (link_quality / 100) * 2.5` (range 1.5–4 px).
  - `line-opacity` now uses `['get', 'opacity']` — decays by age: <5 min → 0.9, <15 min → 0.6, <30 min → 0.35, older → 0.15.
  - Local `MeshLink` interface updated to include `last_seen` and `link_quality` (already present in store type).

---

## Phase 3 — Map Visualizations (MeshCore)

### Feature 6: Signal Heatmap *(large)*
- **Create:** `frontend/src/layers/buildMeshHeatmapLayer.ts` — Deck.gl `HeatmapLayer`. Each mesh node with known lat/lon is a weighted point; weight = mean SNR across its links, normalized from [-120, -50] dBm to [0, 1]. `radiusPixels: 80`.
- **Modify:** `frontend/src/components/MapOverlay.tsx` — add layer.
- **Modify:** `frontend/src/store.ts` — add `meshHeatmapVisible: boolean` + setter, add to `partialize`.
- **Requires:** Phase 1A (node coords in topology endpoint).

### Feature 10: Coverage Polygon Estimation *(large)*
- **Create:** `frontend/src/layers/coverageEstimation.ts` — `snrToRadiusMeters(snr)` using simplified Friis path loss inversion (path loss exponent = 3.5), `circlePolygon(lon, lat, radiusM, steps = 32)`.
- **Create:** `frontend/src/layers/buildCoverageLayer.ts` — Deck.gl `PolygonLayer` with low-opacity fill and visible stroke, one polygon per node.
- **Modify:** `frontend/src/store.ts` — add `coverageVisible: boolean` + setter, add to `partialize`.
- **Requires:** Phase 1A + Feature 5 populated.

---

## Phase 4 — Panel Features

### Feature 3: APRS Weather Station Panel *(small)*
After Phase 1B populates `identity.wx`:
- **Modify:** `frontend/src/components/panels/entity/AprsOverview.tsx` — conditional weather data card for `station_type === 'weather'` showing `temp_f`, `humidity`, `pressure_mb`, `wind_mph`/`wind_dir_deg`, `rain_in`.
- **Modify:** `frontend/src/components/panels/EntityDetail.tsx` — add `'weather'` tab for APRS weather stations (same tab pattern as aircraft).

### Feature 7: Battery/Health Fleet View *(medium)*
- **Create:** `frontend/src/components/panels/MeshFleetPanel.tsx` — sortable table of all `mesh_node` entities: name, battery % bar (green ≥60% / amber ≥30% / red <30%), voltage, `on_radio` indicator, contact type, last-seen age.
- **Modify:** `frontend/src/components/panels/CommsPanel.tsx` — add "Fleet" tab alongside existing "Spectral Health" tab.

### Feature 8: Message Browser UI *(medium)*
The existing `CommsPanel.tsx` message feed is functional but flat. Enhancements:
- **Modify:** `frontend/src/components/panels/CommsPanel.tsx`
  - Group `filteredMessages` by `conversation_key` with sticky group headers + unread indicators.
  - Add conversation selector sidebar (unique conversations + "All").
  - Show delivery ack status on all `msg_type === 'direct'` messages.

---

## Phase 5 — Alert Features

### Feature 2: Emergency Station Alerts *(small)*
- **Create:** `poller/aprs_alerts.py` — rate-limited emitter (300s cooldown per entity_id). Writes `Event` row with `event_type = "aprs_emergency"`, `severity = "critical"`, `summary = "APRS EMERGENCY: {callsign}"`. Publishes to `civic:updates` Redis channel.
- **Modify:** `poller/pollers/aprs.py` — call after `publish_entity()` when `station_type == "emergency"`.
- Frontend: zero changes needed — `EventLogPanel` renders any `event_type` string generically.

### Feature 9: Link Degradation Alerts *(medium)*
- **Modify:** `poller/pollers/meshcore.py` — call `check_link_degradation()` in `_upsert_mesh_links()` after each upsert.
- **Modify:** `poller/mesh_link_alerts.py` — implement crossing-detection logic (previous SNR above threshold, current below) + cooldown gate. Fires `event_type = "mesh_link_degraded"`, `severity = "warning"`.
- **Add:** `GET /mesh/alert-config` + `PATCH /mesh/alert-config` to `backend/routers/mesh.py` for per-source threshold configuration.
- **Requires:** Phase 1C (DB table + module scaffold).

---

## Dependency Graph

```
Phase 1A ─────────────────────► Features 6, 10
Phase 1B ─────────────────────► Feature 3
Phase 1C ─────────────────────► Feature 9

Feature 1   — no deps
Feature 2   — no deps
Feature 4   — no deps  ✅ SHIPPED
Feature 5   — no deps  ✅ SHIPPED
Feature 6   — after 1A + 5
Feature 7   — no deps
Feature 8   — no deps
Feature 9   — after 1C
Feature 10  — after 1A + 5
Feature 3   — after 1B
```

---

## TypeScript Store Changes Required

| Field | Store | Purpose |
|---|---|---|
| `meshHeatmapVisible: boolean` | `store.ts` + `partialize` | Feature 6 layer toggle |
| `coverageVisible: boolean` | `store.ts` + `partialize` | Feature 10 layer toggle |

No changes needed to `Entity`, `Track`, `MeshLink`, or `MeshMessage` interfaces — new data arrives via the existing `identity: Record<string, unknown>` field.

---

## Complexity Summary

| # | Feature | Effort | Phase | Backend | Frontend | DB? |
|---|---|---|---|---|---|---|
| 1 | APRS symbol colors | Medium | 2 | — | New layer + MapOverlay | No |
| 2 | Emergency alerts | Small | 5 | New poller module | — | No |
| 3 | Weather station panel | Small | 4 | New enrichment module | AprsOverview + EntityDetail | No |
| 4 | APRS trails | Small | 2 | — | useTrailHydration | No |
| 5 | Topology link polish | Small | 2 | Topology endpoint | MeshLinksLayer | No |
| 6 | Signal heatmap | Large | 3 | — | New layer + store flag | No |
| 7 | Battery fleet view | Medium | 4 | — | New panel component | No |
| 8 | Message browser | Medium | 4 | — | CommsPanel refactor | No |
| 9 | Link degradation alerts | Medium | 5 | New poller module + endpoint | — | Yes (1C) |
| 10 | Coverage polygons | Large | 3 | — | New layer files + store flag | No |
