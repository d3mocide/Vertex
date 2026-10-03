# Map Layer Architecture

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
6. Cameras: `frontend/src/layers/buildCameraLayer.ts`
7. Events: `frontend/src/layers/buildEventLayers.ts`
8. Geofences/custom layers/observation ring/annotations:
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

### Priority review — 2026-10-01

The review below records the original stack. Entity/trail priority and native overlay ordering were implemented on 2026-10-01; see implementation notes below.

`MapOverlay.tsx` uses a non-interleaved Deck canvas above MapLibre. Pre-change Deck submission order, **bottom to top**:

1. Custom geometry, geofences, observation rings.
2. Mesh nodes, stream gauges.
3. History trails, dynamic bridges/predictions, selected trail and selected transit route.
4. Dispatch halos/icons.
5. Entity selection/emergency rings, aircraft role glows, shared entity outlines/icons, aircraft source badges and APRS/TAK/sensor labels.
6. System event pulses, individual lightning strikes, cameras.
7. Saved annotation polygons, lines, markers and labels.

Aircraft, vessels, buses, trains, APRS, TAK, fire incidents and sensors share one icon batch. There is no explicit type priority; overlapping instances can depend on input order and rendering depth. Bus/train superiority is not an intentional policy. Dispatch is submitted below every entity type; cameras and annotations are submitted above aircraft. Deck depth testing remains at its library default, so submission order alone does not guarantee every overlap outcome.

MapLibre weather/area layers mostly append without a shared ordering policy. Several are created only when enabled, rail loads asynchronously, and radar can remove/re-add its layers. OSM rail explicitly stays below GTFS rail, but no common policy stabilizes the rest. React component order is therefore not a guaranteed runtime stack. Imagery can cover warning shading or basemap labels depending on insertion timing.

Recommended hierarchy, **highest first**:

| Priority | Content | Reason |
| --- | --- | --- |
| 1 | Aircraft, including outlines and role glows | Keep the air picture above ground activity, as requested. |
| 2 | Dispatch incident icons and halos | Actionable located calls above routine entities. |
| 3 | Fire incident icons, emergency APRS, lightning strikes and system event pulses | Hazards above routine traffic; informational pulses remain below dispatch. |
| 4 | TAK clients and ordinary APRS | Local operational ground activity. |
| 5 | Vessels | Maritime movement above dense ground transit. |
| 6 | Trains, then buses | Routine transit below hazards; dense buses should not dominate. |
| 7 | Stream gauges, mesh nodes, RF sensors and cameras | Fixed infrastructure below moving entities. |
| 8 | Saved annotation markers/labels and custom points | Operator context below operational symbols. |
| 9 | Selected transit routes, annotation lines, mesh links and route networks | Network/context geometry below markers; entity trails belong to their entity's tier. |
| 10 | Fire perimeters, outage/geofence areas, annotation/custom polygons and region/range boundaries | Broad areas below point symbols; important outlines above broad fills. |
| 11 | NWS warning raster, radar, lightning density, fire danger, smoke, satellite imagery | Warnings above background imagery, all beneath operational geometry. |
| 12 | Basemap and terrain/hillshade | Geographic foundation; preserve road/place labels above broad shading where practical. |

Each entity's history trail belongs to the same priority tier as that entity. This includes selected history, gap bridges and motion predictions where supported. These remain separate Deck path/icon layers, grouped into one logical priority tier rather than one literal rendering layer. For example, aircraft history sits above dispatch and ground activity, while bus history stays below dispatch and aircraft. Published transit route shapes describe the network rather than observed motion and remain in tier 9, including a selected vehicle's full route highlight.

Within each tier, draw ordinary history and bridges/predictions first, then selected history, halos/glows, outlines, icons and zoom-gated labels. All trails in a tier stay behind all icons in that tier, so one aircraft's history does not cover another aircraft's marker. Selection highlights an entity and its history within their own tier; a selected bus should not rise above aircraft or dispatch. Active drawing handles, tooltips and controls are interaction affordances outside the data hierarchy.

Higher-tier trails can cross lower-tier icons. Keep history visually subordinate with restrained width, opacity and existing visibility controls; grouping history with its entity should not make trails as prominent as markers. Preserve cached history construction and batch paths by tier rather than creating layers per object. This needs overlap/performance validation but does not inherently increase trail geometry.

Implementation should split entity and trail batches into matching stable priority groups using the same entity classification: sorting one shared icon array cannot insert dispatch between aircraft and ground entities. Centralize Deck tier assembly and explicitly control flat-overlay depth behavior rather than inventing geographic elevations as a z-index. Stabilize MapLibre raster insertion using named anchors across lazy enable, refresh and asynchronous load paths.

Existing operational MapLibre geometry (fire/outage areas, region bounds, mesh links and GTFS routes) needs a scoped Deck migration under the repository architecture rules; OSM rail can remain basemap infrastructure. The renderer split prevents one global numeric z-index from controlling all data today.

Validate implementation with synthetic coincident aircraft/dispatch/transit/camera markers, crossing history trails, saved polygons, selected entities, tilted views, click picking and weather toggle sequences. Verify that trails follow their entity tier and stay behind peer icons in live and replay modes; profile dense trail views. Preserve zoom gating and feed filters. The priority implementation retains the existing feed filters and trail visibility behavior.

### Priority implementation — 2026-10-01

- `layerPriority.ts` assigns matching entity/history tiers and orders Deck layers centrally. Batches have stable tier-suffixed IDs; entity hover recognizes those IDs. Selected history stays behind peer icons and within the entity tier. Existing cached history construction is preserved.
- The Deck canvas explicitly uses `depthCompare: always` and disables depth writes, making draw order govern both flat and tilted operational overlays. All tiers retain their existing glyphs, colors, zoom gates and picking behavior. Transparent glyph cutouts allow picking visible content underneath.
- `mapStylePriority.ts` reapplies a deterministic native layer order on style changes, with a recursion guard and no moves when already ordered. Satellite/smoke sit below warning/radar layers; area/rail/link overlays sit above weather and beneath Deck. Weather sits below the first road/transport line or basemap symbol layer. Native operational geometry, including rail tracks/routes, sits above the entire basemap and below Deck; roads and labels therefore cannot cover rail lines.
- Existing MapLibre fire/outage areas, region bounds, mesh links and GTFS rail geometry remain compatibility paths in this first ordering pass. Their renderer migration remains separate follow-up work; there is no new operational MapLibre layer. Cross-renderer context geometry cannot yet share Deck's exact per-tier interleaving.
- Aircraft use plain chevrons with no provenance marks. Source information is available in hover/details and existing local/external feed controls; tooltip source text has its own line below the callsign.

1. Add Settings toggles for per-category labels (APRS, gauges, TinyGS sat names).
2. Add viewport-aware label caps to Deck text layers.
3. Add layer diagnostics panel (counts per layer, label counts, last feed timestamp).

### Aircraft and vessel motion

`frontend/src/layers/pvb.ts` corrects the moving report anchor with a Hermite offset that preserves displayed position and velocity when reports arrive or feeds switch. Orientation eases over the shortest angular arc. Large discontinuities reset the anchor; stale non-estimated fixes hold. Aircraft projection remains bounded to 30 seconds; AIS projection stops at 45 seconds with a gradual slowdown during the final ten seconds. Prediction lines start at the displayed marker and respect the remaining window. These estimates do not change measured coordinates or observation history.

Aircraft source and freshness are separate signals. Local and external aircraft share the same plain chevron; provenance is shown in hover/details rather than on the map symbol. Hover source text sits on a separate line beneath the callsign, and long identifiers wrap within the tooltip. Fresh aircraft have equal brightness regardless of source. Stale or dead-reckoned positions dim; tooltips and details identify the position feed and quality. Existing local/external filters and source arbitration remain available.

AIS normalization separates course over ground (movement) from true bow heading (icon orientation), rejects unavailable motion and position values, and handles Class B position reports. Reception clocks are preserved and labelled as source receipt or local receipt; they are not claimed to be measurement clocks. Unknown course, stationary navigation status and old reports do not drive forward prediction. The predictor follows a short course estimate, not an inferred destination route or shipping channel.

### Shared map tooltip styling

All Deck map hover cards use the shared `map-tooltip-card` surface and heading styles in `index.css`: neutral dark background, square edges, semantic accents, bounded width and wrapped identifiers. Entity sources remain on a separate line. Cameras, system events, dispatch incidents, stream gauges, mesh nodes, geofences and custom geometry use the same surface. Hover cards flip left/up near map edges to stay readable.

## Render lifecycle and visibility

The overlay caches visible track filtering, reported history and slow layer groups; high-frequency entity reports synchronize refs without React commits. Hidden-only reports preserve visible data identity. Empty entity/trail layers are omitted, and Deck props are submitted only when a layer instance or ordering changes. Live motion retains its approximately 30 Hz budget; paused replay/static layers can reuse instances. Trail visibility includes predictions, with the existing selected TAK/train history exception.

Map-only geofence, gauge and train warm-up polling is gated by visibility. Disabled weather layers stop refresh timers and remove raster sources; mesh links stop geometry updates. Rail/fire/outage geometry can remain cached but hidden. Shared feed/store ingestion and catalog/panel updates have separate lifecycles and are not disabled by map presentation controls.

See the [frontend rendering review](../reviews/frontend-render-performance-2026-10-01.md) for synthetic measurements, lifecycle checks and the remaining hardware GPU validation.
