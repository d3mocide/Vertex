# Map Layer Architecture — Current State (2026-05-05)

Purpose: single source of truth for where map layers are rendered, why they live there, and what is next for migration/design work.

## Rendering Model

- MapLibre GL is the base map engine (style, raster tile layers, terrain, controls).
- Deck.gl is the operational overlay engine (entities, indicators, selection/picking, labels, tooltips).
- Frontend flow:
  - websocket/entities -> Zustand store
  - `frontend/src/components/MapOverlay.tsx` builds Deck layers each frame
  - Deck overlays render above MapLibre canvas

## Layer Inventory

### MapLibre-owned (base/map infrastructure)

1. Basemap style (vector/raster sources from configured `MAP_STYLE`)
2. Radar raster overlay: `frontend/src/components/layers/RadarLayer.tsx`
3. Smoke raster overlay: `frontend/src/components/layers/SmokeLayer.tsx`
4. Terrain DEM and exaggeration: `frontend/src/components/layers/TerrainLayer.tsx`
5. Draw-time helpers bound to map interactions:
   - `frontend/src/components/layers/GeofenceLayer.tsx`
   - `frontend/src/components/layers/AnnotationOverlay.tsx`

### Deck-owned (operational presentation overlays)

1. Entity icons/selection/APRS labels: `frontend/src/layers/buildEntityLayers.ts`
2. Trails/predictions: `frontend/src/layers/buildTrailLayers.ts`
3. Stream gauges: `frontend/src/layers/buildStreamGaugeLayer.ts`
4. Lightning strikes: `frontend/src/layers/buildLightningLayer.ts`
5. Mesh nodes: `frontend/src/layers/buildMeshNodeLayer.ts`
6. TinyGS satellites/stations: `frontend/src/layers/buildTinyGSLayer.ts`
7. Cameras: `frontend/src/layers/buildCameraLayer.ts`
8. Events: `frontend/src/layers/buildEventLayers.ts`
9. Geofences/custom layers/observation ring/annotations:
   - `frontend/src/layers/buildGeofenceLayers.ts`
   - `frontend/src/layers/buildCustomLayers.ts`
   - `frontend/src/layers/buildObservationRingLayer.ts`
   - `frontend/src/layers/AnnotationLayer.tsx`

## Recent Changes (this pass)

1. Migrated Mesh overlay from MapLibre circles -> Deck scatter layers.
2. Migrated TinyGS overlays from MapLibre circles/symbols -> Deck scatter layers.
3. Reduced stream gauge marker size for dense-view readability.
4. Removed stream gauge always-on labels.
5. Added APRS label zoom gating to reduce label clutter.

## Declutter Principles (Current)

1. Dense feeds should default to icon/ring-only.
2. Labels should be zoom-gated.
3. Tooltip on hover + click selection carries detail payload.
4. Prefer Deck-based declutter controls (single pipeline) over per-layer MapLibre symbol behavior.

## Open Design Work (for design agent)

1. Define visual hierarchy by severity/priority:
   - selected > critical alert > active movement > passive infrastructure.
2. Define icon system upgrade (SVG atlas candidates) for:
   - stream gauges, mesh nodes, APRS, lightning, fire incidents, cameras.
3. Define density strategy by zoom bucket:
   - max labels per category,
   - optional cluster/aggregate states,
   - emphasis transitions at zoom thresholds.
4. Define accessibility palette checks for all signal colors on dark tactical basemap.

## Suggested Next Engineering Steps

1. Add Settings toggles for per-category labels (APRS, gauges, TinyGS sat names).
2. Add viewport-aware label caps to Deck text layers.
3. Add layer diagnostics panel (counts per layer, label counts, last feed timestamp).
