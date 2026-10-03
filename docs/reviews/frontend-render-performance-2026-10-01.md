# Frontend map rendering review — 2026-10-01

This review covers the map's React subscriptions, Deck layer construction, motion/trail updates and native overlay visibility lifecycles. It does not measure backend ingestion or the entire dashboard's panel rendering.

## Changes

- High-frequency track/entity reports update overlay refs directly instead of committing React solely to synchronize refs. Hidden camera, lightning, dispatch and mesh feeds do not trigger their map components to render.
- Visible track filtering is cached between reports. Hidden-only reports preserve the visible collection's identity, allowing derived data and layer groups to remain cached. Type, source, search, altitude and speed changes invalidate filtering; RF sensor visibility is now honored. Replay uses the same map filters.
- Static/replay entity layers reuse instances when positions, selection, zoom bucket and styling are unchanged. Moving entities, selections and alerts retain animation. Mesh/gauge extraction is keyed to each entity type's update version. Pulse-free static scenes avoid projection work.
- History and selected history use reported positions and retain cached layers between relevant reports. Trails construct only requested, nonempty parts. Turning trails off also removes predictions; the existing selected TAK/train history exception remains. Entity builders omit empty layers from Deck submissions.
- Deck receives new props only when a layer instance or its order changes. Events update their day-scale fade once per minute; lightning updates its 30-second fade at up to 10 Hz. Entity motion still uses the existing approximately 30 Hz update budget.
- Geofence refresh, gauge fallback and train snapping warm-up run only when their map layer is enabled. Geofence/gauge requests are aborted on disable. Published transit route requests are gated by the selected vehicle's visibility.
- Smoke, NWS, lightning-density and GOES sources are removed on disable. Weather refresh timers stop. Radar already tears down its sources, timer and crossfade. Mesh links now follow mesh visibility and stop building geometry while disabled.
- Rail geometry loads/retries only when enabled, ignores late results after disable, and retains hidden cached geometry for quick reuse. Shared rail requests remain shared with train snapping; disabling one consumer does not abort the other's request. Rail enable does not wait for unrelated weather tiles to finish.
- Fire danger, perimeters and outages avoid initial source construction while disabled and abort unfinished requests when hidden. Loaded geometry remains cached with native visibility disabled.

Layer order, tiered history, picking and tooltip styling remain as documented in [map layer architecture](../architecture/map-layers.md).

## Measurements

Synthetic Chromium test: 200 moving tracks (120 aircraft, 40 buses, 20 trains, 10 vessels, 5 RF sensors, 5 ground objects), 460 fixed entities, 60 cameras, 5 geofences, 10 annotations, 2 custom layers, 20 dispatch incidents and 10 lightning strikes. Each moving track has 80 history points. One aircraft report arrives every 250 ms. Each scenario warms for 2 seconds, then samples for 3.5 seconds. Positions and identifiers are synthetic.

Actual Deck/MapLibre rendering, before and after:

| Scenario | React commits before → after | Deck submissions before → after | Submitted layers before → after | Empty layers before → after |
|---|---:|---:|---:|---:|
| Optional layers off | 14 → 0 | 100 → 0 | 17 → 1 | 10 → 0 |
| Aircraft only, trails off | 14 → 0 | 45 → 89 | 30 → 3 | 20 → 0 |
| Operational overlays on | 3 → 0 | 6 → 6 | 90 → 40 | 50 → 0 |
| Off again | 14 → 0 | 103 → 0 | 17 → 1 | 10 → 0 |

The single remaining layer in the disabled scene is the observation range ring. Counts exclude the initial visibility transition. More aircraft submissions after optimization reflect improved frame throughput rather than a higher configured cadence.

This environment uses software WebGL. The dense all-on scene was GPU-bound both before and after (only 6 rendered frames in the sample); these results do **not** establish smooth all-on performance on operator hardware. Even the aircraft-only result is not a device FPS estimate. A larger synthetic scene also overwhelmed software rendering.

A paired construction-only run bypassed Deck submissions to separate JavaScript preparation from GPU work. With operational overlays enabled, mean preparation time was **1.54 ms before and 1.31 ms after**, at about 30 updates/second. These are indicative single-run averages, not a latency guarantee. Motion projection and dynamic trail geometry remain the largest recurring phases. The baseline for this CPU comparison uses the previous overlay/entity/trail builders with the new visibility guards in the annotation/geofence builders; all-on behavior is comparable.

## Verification

- `node tests/map-render-cache.mjs` runs regression checks using the installed Vite toolchain: hidden report identity, visible report invalidation, search/ranges/type filters, RF visibility, derived cache invalidation, predicted/history toggle behavior, tier IDs and selected rail history.
- Synthetic browser checks exercise repeated native off/on/off cycles with radar, smoke, NWS, lightning density, GOES, fire areas, outages, rail and mesh; disabled map-only refresh timers are absent, requests stop, raster/mesh sources are removed and rail remains hidden.
- Browser checks also verify live aircraft layers, prediction omission with trails off, replay interpolation, paused replay layer reuse despite live reports, replay filtering and hidden-feed updates without map React commits or Deck submissions. Browser errors are zero.
- TypeScript, production build and frontend rollout are checked separately in the task log.

## Remaining work and scope

Map visibility controls presentation. Shared WebSocket/store ingestion, backend collectors, catalog synchronization and other panels can still consume resources when map layers are hidden. The animation scheduler also retains a small cached check; “off” does not mean zero application CPU or zero retained memory. Fire/rail geometry is cached, and the observation ring remains enabled.

Next, profile the real dashboard in a hardware-accelerated browser with representative enabled feeds. Capture main-thread work, GPU frame time, long tasks, memory and p95 frame intervals while panning, zooming and repeatedly toggling layers. Dense all-on rendering still needs that validation.

If dense trails remain expensive, prioritize viewport culling with a margin, bounded/zoom-aware history geometry, and stable per-tier history buffers. Preserve selection, picking, filter changes and the rule that history belongs to its entity tier. A rendering cutoff must not silently remove safety-relevant visible entities.
