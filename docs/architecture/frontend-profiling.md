# Frontend developer tools and map profiling

The dashboard has a built-in developer panel for measuring the map on real devices. The development VM renders with
software WebGL, so GPU frame times can only be measured on real hardware (the operator's own machine); the panel says so
when it detects a software renderer.

## Opening it

- Settings → Developer → **Debug Mode** (admin), or
- load the app with `?debug=perf` (frames), `?debug=tests`, `?debug=scene`, `?debug=network` or `?debug=insets` (layout).

A tab opened by URL stays open across reloads for the life of the browser tab (sessionStorage) until you close it with the
close button. The panel can be moved between the four corners. Instrumentation (per-phase timing, WebSocket counters, the
scene snapshot) runs only while the panel is open or a recording is in progress.

## Tabs

| Tab | What it is for |
|---|---|
| **Frames** | Live frame rate, p95 frame time, dropped frames and a frame-time sparkline (last 5 s); per-phase CPU for each layer rebuild (`filter`, `pvb`, `build`, `setProps`, `frameTotal` and the individual layer groups); JS heap; record any interaction for 10/20/30 s and copy the JSON. |
| **Tests** | Scripted, repeatable scenarios (below) with a Quick 5 s mode, **Run all**, results table, **Set baseline** and a per-scenario verdict against the baseline (worse / better / same). **Copy JSON** includes the GPU, user agent and baseline. |
| **Scene** | Which GPU is rendering (red for software rasterizers), camera, canvas size, visible tracks, entities, deck layers submitted and the heaviest layers by item count. |
| **Net** | WebSocket messages and data per second, totals since reset and the busiest message types. |
| **Layout** | The original safe-area / viewport / DOM-layer inspector for iOS PWA letterbox bugs (with the amber inset bands). |

## Scenarios

Each scenario drives the camera and/or layer toggles while recording, then restores the camera and every toggle.

| Scenario | What it does |
|---|---|
| Idle | Nothing touched: live motion and updates only |
| Pan sweep | Continuous panning in a loop around the current view |
| Zoom cycle | Zooms in 2.5 levels and back |
| Tilt and rotate | Pitch to 60 degrees while rotating (the heaviest camera case) |
| Layer toggle storm | Flips one optional overlay every 1.2 s |
| Dense: all overlays | Every overlay on, then idle and pan |
| Terrain 3D | 3D terrain on, tilted, slow rotation (refused under software rendering, where terrain can crash the map) |

While a scenario runs, saving of user preferences is suspended, so its temporary toggles never reach the saved profile,
even if the page is closed mid-run. Compare runs on the same machine with the same feeds enabled and the same window size.

## Console

`__vertexPerfRecord` works without opening the panel:

```js
copy(JSON.stringify(await __vertexPerfRecord(20, 'pan'), null, 1))   // 20 s recording labelled "pan"
```

All recordings of the session are in `window.__vertexPerfRuns`. `localStorage.vertexPerf = '1'` keeps the per-phase
instrumentation on permanently (reload to apply); remove the key to turn it off.

## Reading a result

| Field | Meaning | Good |
|---|---|---|
| `fps`, `vsyncMs` | Achieved rate and the display refresh interval (median frame) | fps near the display rate |
| `frameMs.p95`, `p99` | Frame time tail | p95 under 1.5 x `vsyncMs` |
| `droppedPct` | Frames that missed at least one refresh | under 5% idle, under 10% while panning |
| `hitches` | Frames over 50 ms (visible stutter) | 0 |
| `longTasks` | Main-thread tasks over 50 ms | count 0 idle; short while panning |
| `layerBuildMs.p50` / `p95` | Time between layer rebuilds, i.e. the rate entity motion really updates at | p50 equals the configured 33 ms or better |
| `phases.*.meanMs` | CPU per rebuild by phase | `frameTotal` well under the rebuild interval |
| `heapMB` | JS heap at start and end (Chromium only) | no steady growth across repeated runs |
| `counts`, `gpu`, `viewport` | Scene size, GPU renderer and window size | context for the numbers |

If dense scenes miss the targets, the planned remedies are viewport culling with a margin, bounded and zoom-aware
history geometry, and a rebuild cadence that adapts to the measured build cost. See
`docs/reviews/frontend-render-performance-2026-10-01.md` for what has already been done.
