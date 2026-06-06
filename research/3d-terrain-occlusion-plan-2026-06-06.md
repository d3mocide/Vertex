# 3-D Terrain Occlusion & Map Rendering Upgrade — Plan

**Date:** 2026-06-06
**Branch:** `claude/vertex-map-3d-rendering-JE0bN`
**Author:** Agent session

## Motivation

Reference target (Kpler / @CraigTaylorViz, Mapbox + three.js): vessels and tracks
**disappear behind 3-D terrain** — true depth occlusion against an exaggerated
DEM, plus a glowing animated "flow" aesthetic for tracks.

Vertex already has real 3-D terrain in MapLibre (`TerrainLayer.tsx`:
`raster-dem` + `setTerrain` + hillshade + auto-pitch), but **cannot** occlude
entities behind it.

## Root cause

`MapOverlay.tsx` renders deck.gl onto a **separate canvas stacked on top** of
the MapLibre canvas (`pointer-events:none`, view state hand-synced every frame).
The two canvases never share a depth buffer, so every aircraft, vessel, and
trail composites *over* the terrain regardless of geometry. The
`StencilClearLayer` hack in `buildEntityLayers.ts` is a symptom of that
compositing fight.

## Design

### 1. Interleaved rendering (the unlock)
Replace the hand-rolled overlay canvas with **`MapboxOverlay`** from
`@deck.gl/mapbox` (added, pinned `9.3.1`). Interleaved mode renders deck layers
*inside MapLibre's WebGL context and depth buffer*, so per-layer depth testing
against the terrain mesh becomes possible. MapLibre now owns the camera — the
per-frame `viewState` sync and `StencilClearLayer` are deleted.

Picking moves from `deck.pickObject` → `overlay.pickObject`; the tooltip/click
bridge logic is otherwise preserved.

### 2. Per-layer occlusion buckets (avoids terrain draping)
A deck layer at `z=0` sits at **sea level**, not draped on terrain. Rather than
drape land geometry (expensive, fragile), occlusion is opt-in **per layer** via
`parameters.depthTest`, gated behind a `threeD` flag (= `terrainEnabled`):

| Bucket | z | depthTest (3-D) | Result |
|--------|---|-----------------|--------|
| **Aircraft** (air icons, air trails, predicted) | `altMeters` | true | Fly at true altitude; ridges occlude low traffic |
| **Vessels** (sea icons + trails) | 0 (sea level) | true | Headlands/islands occlude vessels — the reference effect |
| **Land markers** (APRS/ground, rail, hazard, sensor, their trails) | 0 | **false** | Always visible — an SA station must never hide inside a hill |
| **UI** (selection pulse, labels, rings, events, geofences, annotations) | 0 | false | Always on top |

When `threeD` is false everything uses `depthTest:false` and no z-offset →
pixel-identical to the pre-change flat overlay. This keeps the Raspberry Pi 5
baseline cheap; 3-D is opt-in via the existing **3D Terrain** toggle.

### 3. Atmosphere & buildings (look)
- `sky` + `fog` added with terrain for horizon depth (`TerrainLayer.tsx`).
- `fill-extrusion` 3-D buildings where the basemap supplies footprints, behind a
  new **3D Buildings** toggle (skipped silently if the source lacks them).
- Exaggeration **presets** alongside the existing slider.

### 4. Glowing animated trails (flow aesthetic)
Optional `TripsLayer` (`@deck.gl/geo-layers`, pinned `9.3.1`) with additive
blending and a fading head, behind a new **Animated Trails** toggle (default
off). Fed from raw `trail` tuples (which carry `ts` + altitude).

## Phasing
0. Deps + store flags. ✅
1. `MapboxOverlay` interleaved migration (no visual change in flat mode).
2. Occlusion + altitude buckets.
3. Sky / fog / buildings.
4. Animated trails.
5. `/pre-commit-check`, `npm run build`, `/update-task-log`.

## Risks
- **Picking rewrite** — main regression surface (hover + selection).
- **Pi 5 perf** — mitigated by gating all 3-D behind `terrainEnabled`.
- **MapLibre 4.7 × deck 9.3 interleaved depth** — verified empirically in Phase 2.
