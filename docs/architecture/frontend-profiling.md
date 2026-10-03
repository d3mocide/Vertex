# Frontend map profiling

The map overlay has an opt-in profiler. The development VM renders with software WebGL, so GPU frame times can only be
measured on real hardware (the operator's own machine). This is the protocol for doing that and comparing runs.

## Turning it on

In the browser devtools console on the dashboard (once per browser profile), then reload:

```js
localStorage.vertexPerf = '1'
```

Turn it off with `localStorage.removeItem('vertexPerf')`. When off, nothing is recorded and nothing is exposed.

## Recording

```js
copy(JSON.stringify(await __vertexPerfRecord(20, 'idle'), null, 1))   // 20 s recording labelled "idle"
```

`copy()` puts the JSON on the clipboard. Every recording is also kept in `window.__vertexPerfRuns`. Only one recording
runs at a time; leave the tab focused and in front while it runs (background tabs throttle `requestAnimationFrame`).

## Scenarios

Run each for 20 s with the same feeds enabled, hardware-acceleration on, and the same window size:

| Label | What to do while recording |
|---|---|
| `idle` | Do nothing; live aircraft, vessels and transit moving |
| `pan` | Drag the map continuously across the region |
| `zoom` | Zoom in and out between city and regional scale |
| `toggle` | Switch optional layers (radar, smoke, trails, rail) on and off repeatedly |
| `dense` | Every operational overlay on, then `idle` and `pan` again |

## Reading the result

| Field | Meaning | Good |
|---|---|---|
| `fps`, `vsyncMs` | Achieved rate and the display refresh interval (median frame) | fps near the display rate |
| `frameMs.p95`, `p99` | Frame time tail | p95 under 1.5 x `vsyncMs` |
| `droppedPct` | Frames that missed at least one refresh | under 5% idle, under 10% while panning |
| `hitches` | Frames over 50 ms (visible stutter) | 0 |
| `longTasks` | Main-thread tasks over 50 ms | count 0 idle; short while panning |
| `layerBuildMs.p50` / `p95` | Time between layer rebuilds, i.e. the rate entity motion really updates at | p50 equals the configured 33 ms or better |
| `phases.*.meanMs` | CPU per rebuild by phase (`filter`, `pvb`, `build`, `setProps`, `frameTotal`) | `frameTotal` well under the rebuild interval |
| `heapMB` | JS heap at start and end (Chromium only) | no steady growth across repeated runs |
| `counts` | Tracks, entities and layers in the scene | context for the numbers |

If dense scenes miss the targets, the planned remedies are viewport culling with a margin, bounded and zoom-aware
history geometry, and a rebuild cadence that adapts to the measured build cost. See
`docs/reviews/frontend-render-performance-2026-10-01.md` for what has already been done.
