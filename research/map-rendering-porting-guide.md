# Map Rendering Porting Guide
## MapLibre + Deck.gl: ADSB & AIS Track Visualization

> **Purpose:** Reference artifact and implementation prompt for porting ADSB/AIS map rendering
> (history trails, live icons, path prediction, altitude coloring, atlas icons) to a new system
> that also uses MapLibre + deck.gl.
>
> **Source:** Sovereign Watch frontend (`frontend/src/`)
> **Date:** 2026-04-22

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [MapLibre + Deck.gl Integration](#2-maplibre--deckgl-integration)
3. [Data Shapes & Pipeline](#3-data-shapes--pipeline)
4. [Icon Atlas Setup](#4-icon-atlas-setup)
5. [Current Position Rendering (IconLayer)](#5-current-position-rendering-iconlayer)
6. [History Trail Rendering (PathLayer)](#6-history-trail-rendering-pathlayer)
7. [Altitude Coloring](#7-altitude-coloring)
8. [Speed Coloring (AIS/Maritime)](#8-speed-coloring-aismaritime)
9. [Path Prediction Rendering](#9-path-prediction-rendering)
10. [Layer Z-Ordering & Depth Management](#10-layer-z-ordering--depth-management)
11. [Utility Functions](#11-utility-functions)
12. [Full Implementation Prompt](#12-full-implementation-prompt)

---

## 1. Architecture Overview

```
WebSocket / REST feed
        │
        ▼
  Zustand store (entities Map<uid, Track>)
        │
        ▼
  useAnimationLoop (rAF @ 60 FPS)
   ├─ Dead-reckoning interpolation  ← smooths jitter between updates
   ├─ processEntityFrame()          ← filter, classify, advance positions
   └─ composeAllLayers()            ← builds ALL deck.gl Layer instances
              │
              ▼
   MapboxOverlay.setProps({ layers })
              │
              ▼
   MapLibre canvas  ←──  deck.gl WebGL over-layer
```

**Key principle:** layers are rebuilt and pushed to the overlay every animation frame.
No persistent layer instances; deck.gl diffs internally.

---

## 2. MapLibre + Deck.gl Integration

### 2.1 Packages Required

```
@deck.gl/core
@deck.gl/layers
@deck.gl/mapbox       ← MapboxOverlay (works with MapLibre)
maplibre-gl           ← or mapbox-gl
```

### 2.2 Overlay Setup

```typescript
import { MapboxOverlay } from '@deck.gl/mapbox';

// After map 'load' event:
const overlay = new MapboxOverlay({
  interleaved: false,   // MUST be false — avoids MapLibre depth occlusion
  _full3d: false,       // Globe depth buffer issues with near-surface objects
  layers: [],
});
map.addControl(overlay);

// Each frame:
overlay.setProps({ layers: composeAllLayers(state) });
```

### 2.3 Stencil Buffer Fix (Important)

MapLibre's tile renderer writes to the WebGL stencil buffer to mask tile edges.
This can occlude deck.gl geometry (especially ArcLayer arcs at pitch/tilt angles).
Fix it with a no-op layer that clears the stencil buffer first:

```typescript
import { Layer } from '@deck.gl/core';

class StencilClearLayer extends Layer {
  static layerName = 'StencilClearLayer';
  draw({ gl }: { gl: WebGLRenderingContext }) {
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clear(gl.STENCIL_BUFFER_BIT);
  }
}

// Place this as the FIRST entry in your layer array every frame:
const STENCIL_CLEAR = new StencilClearLayer({ id: 'stencil-clear' });
```

### 2.4 Globe vs Mercator

```typescript
import { GlobeView, MapView } from '@deck.gl/core';

function getView(map: maplibregl.Map) {
  const style = map.getProjection?.()?.name;
  return style === 'globe' ? new GlobeView() : new MapView({ repeat: true });
}
```

---

## 3. Data Shapes & Pipeline

### 3.1 Core Track Type

```typescript
type TrailPoint = [lon: number, lat: number, altMeters: number, speedMs: number, ts?: number];

interface Track {
  uid: string;
  lat: number;
  lon: number;
  altMeters: number;    // meters MSL
  speedMs: number;      // meters/second
  courseTrue: number;   // 0–360° true north
  type: 'air' | 'sea';
  callsign?: string;
  trail: TrailPoint[];         // raw history (newest last)
  smoothedTrail?: number[][];  // Chaikin-smoothed version (see §11)
  predictedPath?: [lon: number, lat: number][];  // optional future track
}
```

### 3.2 Dead-Reckoning Interpolation

Between data updates, advance position at constant velocity:

```typescript
function deadReckon(track: Track, dtMs: number): { lat: number; lon: number } {
  const dtS = Math.min(dtMs, 100) / 1000;  // cap at 100ms
  const distM = track.speedMs * dtS;
  const bearingRad = (track.courseTrue * Math.PI) / 180;
  const R = 6_371_000;
  const lat1 = (track.lat * Math.PI) / 180;
  const lon1 = (track.lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R) +
    Math.cos(lat1) * Math.sin(distM / R) * Math.cos(bearingRad)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(distM / R) * Math.cos(lat1),
    Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}
```

---

## 4. Icon Atlas Setup

Generate a canvas-based sprite atlas at app startup. This avoids network requests and
keeps rendering self-contained.

```typescript
// iconAtlas.ts

export interface IconAtlasResult {
  url: string;        // base64 data URL (canvas.toDataURL())
  width: number;
  height: number;
  mapping: Record<string, { x: number; y: number; width: number; height: number;
                             anchorX: number; anchorY: number; mask: boolean }>;
}

export function createIconAtlas(): IconAtlasResult {
  const CELL = 64;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * 2;   // 128px wide
  canvas.height = CELL * 2;  // 128px tall
  const ctx = canvas.getContext('2d')!;

  // ── Aircraft chevron (top-left cell) ──────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const [ax, ay] = [CELL / 2, CELL / 2];       // cell center
  ctx.moveTo(ax,      ay - 16);                  // nose (top)
  ctx.lineTo(ax + 12, ay + 8);                   // right wing tip
  ctx.lineTo(ax,      ay + 4);                   // tail notch
  ctx.lineTo(ax - 12, ay + 8);                   // left wing tip
  ctx.closePath();
  ctx.fill();

  // ── Vessel chevron (top-right cell) ──────────────────────────────────
  // Identical shape, different cell
  const [vx, vy] = [CELL + CELL / 2, CELL / 2];
  ctx.beginPath();
  ctx.moveTo(vx,      vy - 16);
  ctx.lineTo(vx + 12, vy + 8);
  ctx.lineTo(vx,      vy + 4);
  ctx.lineTo(vx - 12, vy + 8);
  ctx.closePath();
  ctx.fill();

  // ── Halo glow (bottom-left cell) ─────────────────────────────────────
  const [hx, hy] = [CELL / 2, CELL + CELL / 2];
  const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 30);
  grad.addColorStop(0,    'rgba(255,255,255,1.0)');
  grad.addColorStop(0.30, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.70, 'rgba(255,255,255,0.2)');
  grad.addColorStop(1.0,  'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, CELL, CELL, CELL);

  return {
    url: canvas.toDataURL(),
    width: canvas.width,
    height: canvas.height,
    mapping: {
      aircraft: { x: 0,    y: 0,    width: CELL, height: CELL, anchorX: CELL/2, anchorY: CELL/2, mask: true },
      vessel:   { x: CELL, y: 0,    width: CELL, height: CELL, anchorX: CELL/2, anchorY: CELL/2, mask: true },
      halo:     { x: 0,    y: CELL, width: CELL, height: CELL, anchorX: CELL/2, anchorY: CELL/2, mask: true },
    },
  };
}

export const ICON_ATLAS = createIconAtlas();
```

**`mask: true`** lets deck.gl multiply the sprite's luminance by `getColor`, so a single
white sprite drives the color without needing per-color variants in the atlas.

---

## 5. Current Position Rendering (IconLayer)

### 5.1 Main Icon Layer (2D/Mercator)

```typescript
import { IconLayer } from '@deck.gl/layers';

new IconLayer<Track>({
  id: 'entity-icons',
  data: tracks,
  iconAtlas: ICON_ATLAS.url,
  iconMapping: ICON_ATLAS.mapping,

  getIcon:     (d) => d.type === 'sea' ? 'vessel' : 'aircraft',
  getPosition: (d) => [d.lon, d.lat],
  getSize:     (d) => d.uid === selectedUid ? 28 : 22,   // pixels
  getColor:    (d) => entityColor(d),   // see §7/§8
  getAngle:    (d) => -d.courseTrue,    // deck.gl: CCW from east; negate for navigation CW-from-north

  sizeUnits: 'pixels',
  billboard: false,          // lies flat, rotates with map bearing
  pickable: true,
  updateTriggers: {
    getAngle: tracks.map(t => t.courseTrue),
    getColor: tracks.map(t => t.altMeters),
  },
})
```

### 5.2 Tactical Halo (special unit types)

Render a soft glow behind specific track categories (SAR, military, helicopter, drone):

```typescript
const HALO_TYPES = new Set(['SAR', 'MIL', 'HEL', 'UAV', 'GOV']);

new IconLayer<Track>({
  id: 'entity-halos',
  data: tracks.filter(t => HALO_TYPES.has(t.category)),
  iconAtlas: ICON_ATLAS.url,
  iconMapping: ICON_ATLAS.mapping,

  getIcon:     () => 'halo',
  getPosition: (d) => [d.lon, d.lat],
  getSize:     () => 52,                      // larger than main icon
  getColor:    () => [255, 136, 0, 140],      // amber, semi-transparent

  sizeUnits: 'pixels',
  billboard: false,
  parameters: { depthTest: false },
})
```

**Render halos BEFORE main icons** in the layer array so they appear beneath.

### 5.3 Selection Ring (pulsing)

```typescript
import { ScatterplotLayer } from '@deck.gl/layers';

// cycle: 0→1 over ~2 seconds, driven by animation loop
new ScatterplotLayer<Track>({
  id: 'selection-ring',
  data: selectedTrack ? [selectedTrack] : [],
  getPosition: (d) => [d.lon, d.lat],
  getRadius:   () => 30 + cycle * 40,                    // 30–70px expanding
  getColor:    (d) => {
    const [r, g, b] = entityColor(d);
    return [r, g, b, Math.round(255 * (1 - cycle * cycle))];  // peaks early
  },
  radiusUnits: 'pixels',
  stroked: true,
  filled: false,
  getLineWidth: 2,
  lineWidthUnits: 'pixels',
})
```

---

## 6. History Trail Rendering (PathLayer)

### 6.1 Trail Data Preparation

Before building the layer, smooth the raw trail:

```typescript
// Called when a new TrailPoint is appended to the track
function prepareTrail(track: Track): void {
  if (track.trail.length >= 2) {
    track.smoothedTrail = chaikinSmooth(
      track.trail.map(p => [p[0], p[1], p[2]]),   // [lon, lat, alt]
      2   // iterations (2 = 4× point density)
    );
  }
}
```

### 6.2 All-Tracks Trail Layer

```typescript
import { PathLayer } from '@deck.gl/layers';

new PathLayer<Track>({
  id: 'history-trails',
  data: tracks.filter(t => t.trail.length >= 2 && t.uid !== selectedUid),

  getPath:  (d) => d.smoothedTrail ?? d.trail.map(p => [p[0], p[1]]),
  getColor: (d) => d.type === 'sea'
    ? speedToColor(d.speedMs, 180)
    : altitudeToColor(d.altMeters, 180),
  getWidth: () => 2.5,

  widthMinPixels: 1.5,
  widthUnits: 'pixels',
  jointRounded: true,
  capRounded: true,
  pickable: false,
})
```

### 6.3 Gap Bridge (last history → current position)

When the smoothed trail's final point differs from the live position by more than 5m,
render a connector segment:

```typescript
import { LineLayer } from '@deck.gl/layers';

const bridgeTracks = tracks.filter(t => {
  if (!t.smoothedTrail?.length) return false;
  const last = t.smoothedTrail.at(-1)!;
  return getDistanceMeters(last[1], last[0], t.lat, t.lon) > 5;
});

new LineLayer<Track>({
  id: 'trail-gap-bridge',
  data: bridgeTracks,
  getSourcePosition: (d) => d.smoothedTrail!.at(-1)! as [number, number, number],
  getTargetPosition: (d) => [d.lon, d.lat, d.altMeters],
  getColor: (d) => entityColor(d),
  getWidth: 3.5,
  widthUnits: 'pixels',
})
```

### 6.4 Selected Track Trail (highlighted)

```typescript
new PathLayer<Track>({
  id: 'selected-trail',
  data: selectedTrack?.trail.length >= 2 ? [selectedTrack] : [],
  getPath:  (d) => d.smoothedTrail ?? d.trail.map(p => [p[0], p[1]]),
  getColor: (d) => d.type === 'sea'
    ? speedToColor(d.speedMs, 255)          // alpha 255 = opaque (selected)
    : altitudeToColor(d.altMeters, 255),
  getWidth: 3.5,
  widthMinPixels: 2,
  widthUnits: 'pixels',
  jointRounded: true,
  capRounded: true,
})
```

---

## 7. Altitude Coloring

Used for ADSB/air tracks. Maps altitude (0–13 000 m) to a 10-stop color ramp with
gamma correction that expands the low-altitude color range.

```typescript
// colorUtils.ts

type RGBA = [number, number, number, number];

const ALTITUDE_STOPS: [number, [number, number, number]][] = [
  [0.00, [  0, 255, 100]],   // green   (ground)
  [0.10, [ 50, 255,  50]],   // lime
  [0.20, [150, 255,   0]],   // yellow-green
  [0.30, [255, 255,   0]],   // yellow
  [0.40, [255, 200,   0]],   // gold
  [0.52, [255, 150,   0]],   // orange
  [0.64, [255, 100,   0]],   // red-orange
  [0.76, [255,  50,  50]],   // red
  [0.88, [255,   0, 100]],   // crimson
  [1.00, [255,   0, 255]],   // magenta (ceiling)
];

const MAX_ALT = 13_000;   // meters (~FL430)
const GAMMA   = 0.4;      // exponent < 1 expands low-altitude range

export function altitudeToColor(altMeters: number, alpha = 220): RGBA {
  const t = Math.pow(Math.max(0, Math.min(altMeters, MAX_ALT)) / MAX_ALT, GAMMA);

  for (let i = 1; i < ALTITUDE_STOPS.length; i++) {
    const [t1, c1] = ALTITUDE_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = ALTITUDE_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
        alpha,
      ];
    }
  }
  return [...ALTITUDE_STOPS.at(-1)![1], alpha] as RGBA;
}
```

---

## 8. Speed Coloring (AIS/Maritime)

Maps vessel speed (0–25+ knots) to a blue-cyan gradient.

```typescript
const SPEED_STOPS: [number, [number, number, number]][] = [
  [0.00, [  0,  60, 140]],   // dark blue  (stopped)
  [0.20, [  0,  90, 200]],   // blue
  [0.40, [  0, 150, 220]],   // medium blue
  [0.60, [  0, 200, 230]],   // teal-blue
  [0.80, [  0, 230, 230]],   // cyan
  [1.00, [100, 255, 255]],   // bright cyan (fast)
];

const MAX_SPEED_MS = 25 * 0.5144;   // 25 knots in m/s

export function speedToColor(speedMs: number, alpha = 220): RGBA {
  const t = Math.max(0, Math.min(speedMs, MAX_SPEED_MS)) / MAX_SPEED_MS;
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [t1, c1] = SPEED_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = SPEED_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
        alpha,
      ];
    }
  }
  return [...SPEED_STOPS.at(-1)![1], alpha] as RGBA;
}
```

**Unified `entityColor` helper** used for icons and gap bridges:

```typescript
export function entityColor(track: Track): RGBA {
  return track.type === 'sea'
    ? speedToColor(track.speedMs)
    : altitudeToColor(track.altMeters);
}
```

---

## 9. Path Prediction Rendering

Render a dashed line from the current position along a predicted path array.
For AIS this could be simple DR; for ADSB it could come from the feed.

```typescript
new PathLayer<Track>({
  id: 'predicted-path',
  data: tracks.filter(t => t.predictedPath && t.predictedPath.length > 1),

  getPath:  (d) => [
    [d.lon, d.lat],          // start at live position
    ...d.predictedPath!,
  ],
  getColor: (d) => {
    const [r, g, b] = entityColor(d);
    return [r, g, b, 160];  // dimmer than history trail
  },
  getWidth: 2,
  widthUnits: 'pixels',

  getDashArray: () => [6, 4],   // 6px dash, 4px gap
  dashJustified: true,
  extensions: [new PathStyleExtension({ dash: true })],
})
```

Note: dashed PathLayer requires `@deck.gl/extensions` `PathStyleExtension`.

```typescript
import { PathStyleExtension } from '@deck.gl/extensions';
```

---

## 10. Layer Z-Ordering & Depth Management

### 10.1 Render Order

Deck.gl renders layers in array order (index 0 = bottom). For a typical ADS-B/AIS overlay:

```
[
  StencilClearLayer,     // 0 – clears tile stencil bleed
  // ... base/environment layers ...
  trailLayer,            // below icons
  gapBridgeLayer,
  predictedPathLayer,
  haloLayer,             // below icons
  selectionRingLayer,
  iconLayer,             // on top
]
```

### 10.2 Globe Mode Depth Bias

In globe projection, deck.gl uses the depth buffer for occlusion by the Earth surface.
Layers need a `depthBias` to render correctly above the surface:

```typescript
// Typical values (more negative = rendered further forward / on top):
// -200  entity icons (must clear Earth surface)
// -150  halos
// -100  selection ring
//  -50  trails / predicted path
//   0   base layers

parameters: {
  depthTest: true,          // globe mode only
  depthBias: -150.0,
}
```

In Mercator mode, set `depthTest: false` and `depthBias: 0` — DOM order is sufficient.

```typescript
function depthParams(globeMode: boolean, bias: number) {
  return globeMode
    ? { depthTest: true,  depthBias: bias }
    : { depthTest: false, depthBias: 0 };
}
```

---

## 11. Utility Functions

### 11.1 Chaikin Trail Smoothing

```typescript
export function chaikinSmooth(pts: number[][], iterations = 2): number[][] {
  if (pts.length < 3) return pts;
  let out = pts;
  for (let k = 0; k < iterations; k++) {
    const next: number[][] = [out[0]];  // keep first point
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      const dims = a.length;
      const p1 = Array.from({ length: dims }, (_, d) => 0.75 * a[d] + 0.25 * b[d]);
      const p2 = Array.from({ length: dims }, (_, d) => 0.25 * a[d] + 0.75 * b[d]);
      next.push(p1, p2);
    }
    next.push(out.at(-1)!);  // keep last point
    out = next;
  }
  return out;
}
```

### 11.2 Haversine Distance

```typescript
export function getDistanceMeters(lat1: number, lon1: number,
                                   lat2: number, lon2: number): number {
  const R = 6_371_000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

### 11.3 Rhumb Bearing

```typescript
export function getBearing(lat1: number, lon1: number,
                            lat2: number, lon2: number): number {
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const Δψ = Math.log(Math.tan(φ2/2 + Math.PI/4) / Math.tan(φ1/2 + Math.PI/4));
  const θ = Math.atan2(Δλ, Δψ) * 180 / Math.PI;
  return (θ + 360) % 360;
}
```

---

## 12. Full Implementation Prompt

> Copy this section as a self-contained prompt to an AI assistant (or to yourself)
> when implementing the port.

---

### Prompt: Port ADSB/AIS Map Rendering to New System

**Context:**
I am building a situational awareness map using MapLibre GL JS + deck.gl.
I need to render ADSB (aircraft) and AIS (vessel) tracks with the following features.
All source data arrives via WebSocket as track updates, accumulated into a `Map<uid, Track>`.
The UI runs a 60 FPS requestAnimationFrame loop that drives layer updates.

**Track Data Shape:**
```typescript
type TrailPoint = [lon: number, lat: number, altMeters: number, speedMs: number, ts?: number];

interface Track {
  uid: string;
  lat: number;
  lon: number;
  altMeters: number;    // meters MSL; 0 for vessels
  speedMs: number;      // m/s
  courseTrue: number;   // 0–360°, true north
  type: 'air' | 'sea';
  callsign?: string;
  category?: string;
  trail: TrailPoint[];           // history, newest last
  smoothedTrail?: number[][];    // set after Chaikin smoothing
  predictedPath?: [number, number][];  // optional future positions
}
```

**Required Features — implement all of the following:**

**1. MapLibre + Deck.gl Integration**
- Use `@deck.gl/mapbox` `MapboxOverlay` with `interleaved: false`
- Place a `StencilClearLayer` (custom Layer subclass) as the first layer every frame
  to clear WebGL stencil buffer bleed from MapLibre tile rendering
- Support globe mode: use `GlobeView` when projection is `'globe'`, else `MapView({ repeat: true })`
- Push updated layers via `overlay.setProps({ layers })` each animation frame

**2. Icon Atlas (runtime canvas, no external image files)**
- Create a 128×128 canvas at startup
- Draw 3 sprites in a 2×2 grid of 64×64 cells:
  - `aircraft` (top-left): white point-up chevron, anchor at center
  - `vessel` (top-right): identical chevron, anchor at center
  - `halo` (bottom-left): soft radial gradient glow (white core → transparent edge), anchor at center
- All sprites use `mask: true` in the mapping so `getColor` tints them
- Export as `{ url: canvas.toDataURL(), width, height, mapping }`

**3. Current Position Icons (deck.gl `IconLayer`)**
- Render all tracks as chevron icons at their current `[lon, lat]`
- `getIcon`: `'vessel'` for sea, `'aircraft'` for air
- `getAngle`: `-courseTrue` (deck.gl is CCW from east; negate to get CW from north)
- `getColor`: `altitudeToColor(altMeters)` for air, `speedToColor(speedMs)` for sea
- `getSize`: 28px for selected track, 22px for others
- `sizeUnits: 'pixels'`, `billboard: false`
- Tactical halo layer (amber glow) rendered BEFORE main icons for SAR/military/helicopter/drone tracks
- Pulsing `ScatterplotLayer` selection ring for selected track (radius 30→70px, alpha fades)

**4. History Trails (deck.gl `PathLayer`)**
- Pre-smooth `trail` with 2 iterations of Chaikin corner-cutting into `smoothedTrail`
  - Each iteration: for each segment, emit points at 1/4 and 3/4; preserve first and last
  - Interpolate Z (altitude) as well as lon/lat
- Render `smoothedTrail` as `PathLayer` for all non-selected tracks (alpha 180)
- Render selected track trail brighter (alpha 255), slightly thicker
- If the last smoothed point is > 5m from the live position, render a `LineLayer` gap bridge
- Color: sea → `speedToColor`, air → `altitudeToColor`
- Style: `jointRounded: true, capRounded: true, widthMinPixels: 1.5`

**5. Altitude Coloring (ADSB/air)**
- 10-stop gradient from 0 m (green `#00FF64`) to 13 000 m (magenta `#FF00FF`)
- Apply gamma correction: `t = (alt / 13000) ^ 0.4` before interpolating stops
- Full stop table:
  ```
  0.00 → [  0, 255, 100]
  0.10 → [ 50, 255,  50]
  0.20 → [150, 255,   0]
  0.30 → [255, 255,   0]
  0.40 → [255, 200,   0]
  0.52 → [255, 150,   0]
  0.64 → [255, 100,   0]
  0.76 → [255,  50,  50]
  0.88 → [255,   0, 100]
  1.00 → [255,   0, 255]
  ```

**6. Speed Coloring (AIS/maritime)**
- 6-stop gradient from 0 m/s (dark blue) to 25 knots / 12.86 m/s (bright cyan)
- Linear interpolation, no gamma correction
- Stop table:
  ```
  0.00 → [  0,  60, 140]
  0.20 → [  0,  90, 200]
  0.40 → [  0, 150, 220]
  0.60 → [  0, 200, 230]
  0.80 → [  0, 230, 230]
  1.00 → [100, 255, 255]
  ```

**7. Path Prediction**
- If a track has `predictedPath`, render a dashed `PathLayer` from the live position
  through the prediction points
- Use `PathStyleExtension` from `@deck.gl/extensions` with `getDashArray: [6, 4]`
- Color: entity color at alpha 160 (dimmer than history)

**8. Layer Order (bottom to top)**
```
StencilClearLayer
... environment/base layers ...
trailLayer (all non-selected)
gapBridgeLayer
predictedPathLayer
haloLayer (special categories)
selectionRingLayer
iconLayer (all tracks)
selectedTrailLayer (on top of general trail)
```

**9. Globe vs Mercator Depth Management**
- Globe mode: `parameters: { depthTest: true, depthBias: <bias> }`
  - Icons: -200, halos: -150, rings: -100, trails: -50
- Mercator mode: `parameters: { depthTest: false, depthBias: 0 }` (DOM order only)

**Utility functions to implement:**
- `altitudeToColor(altM, alpha)` → `[r, g, b, a]`
- `speedToColor(speedMs, alpha)` → `[r, g, b, a]`
- `entityColor(track)` → dispatches to above
- `chaikinSmooth(pts[][], iterations)` → smoothed pts
- `getDistanceMeters(lat1, lon1, lat2, lon2)` → meters (haversine)
- `getBearing(lat1, lon1, lat2, lon2)` → 0–360° rhumb bearing

**Tech stack assumptions:** TypeScript, React, deck.gl ≥ 9, MapLibre GL JS ≥ 4, Zustand store.
Organize into: `iconAtlas.ts`, `colorUtils.ts`, `geoUtils.ts`, `buildEntityLayers.ts`,
`buildTrailLayers.ts`, `MapOverlay.tsx`.
