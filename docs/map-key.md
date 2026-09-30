# Map Key

This page describes how map symbols render in Vertex by zoom level and signal type.

## Last Updated From Code

- Date: 2026-09-29
- Intent: Keep this page synchronized with rendering rules in the frontend layer builders.
- Primary source files:
  - `frontend/src/layers/buildEntityLayers.ts` and `colorUtils.ts`
  - `frontend/src/aircraftRoles.ts`
  - `frontend/src/layers/buildDispatchLayer.ts`
  - `frontend/src/layers/buildEventLayers.ts`
  - `frontend/src/layers/buildLightningLayer.ts`
  - `frontend/src/layers/buildStreamGaugeLayer.ts`
  - `frontend/src/layers/buildMeshNodeLayer.ts`
  - `frontend/src/layers/buildCameraLayer.ts`
  - `frontend/src/layers/buildGeofenceLayers.ts`
  - `frontend/src/layers/buildObservationRingLayer.ts`
  - `frontend/src/components/layers/` (MapLibre raster and polygon overlays)

If map symbol behavior changes, update this document in the same change set.

## Zoom Buckets

- Far: zoom < 6
- Mid: zoom 6 to 8
- Close: zoom >= 9

Most icon layers degrade the same way: a plain **dot** when far, a **ring** (or the full icon for moving entities) at mid zoom, and the **full icon** when close.

## Entity Layer

Source: `buildEntityLayers.ts`. Entities are aircraft, vessels, APRS stations, TAK clients, trains, RF sensors and fire hazards.

### Icon behavior

| Entity | Far | Mid | Close |
|--------|-----|-----|-------|
| Aircraft (ADS-B) | dot | aircraft icon | aircraft icon |
| Vessel (AIS) | dot | vessel icon | vessel icon |
| TAK client | dot | TAK icon | TAK icon |
| Train (Amtrak, TriMet) | dot | train icon | train icon |
| APRS station | dot | dot | APRS icon |
| RF sensor | dot | dot | sensor icon |
| Fire hazard | dot | dot | fire icon |

### Icon sizes

- Far: 8 px
- Mid: aircraft and vessels 32 px (selected 40 px); everything else 10 px
- Close: APRS 24 px (selected 30 px), trains 28 px (selected 36 px), everything else 32 px (selected 40 px)

### Colors

- **Aircraft** — altitude gradient: green at ground level, through yellow and orange, to red and magenta at high altitude (scaled to 13,000 m). A mission tag color overrides the gradient when present.
- **Vessels** — speed gradient: dark blue when slow to bright cyan when fast (scaled to 25 knots).
- **APRS** — by station type: emergency red, weather light blue, infrastructure violet, aircraft cyan, marine blue, fixed green, mobile/unknown violet.
- **TAK clients** — teal. **Trains** — amber. **RF sensors** — lime green. **Fire hazards** — orange-red.

### Labels

- APRS callsigns and RF sensor names appear at zoom >= 10
- TAK callsigns appear at zoom >= 9

### Aircraft with a job (role glow)

Aircraft whose registration or owner identifies a role get a soft glow in the shape of the aircraft:

| Role | Glow |
|------|------|
| Search and rescue, air ambulance, aerial firefighting | red |
| Law enforcement | amber |
| Military, news/media, government | grey |

An aircraft squawking an emergency code (7700 and similar) glows red and slowly pulses, and gets an expanding red ring. Roles come from registration and owner data, never from callsign guesses. The flight log has a *Notable* filter for these aircraft.

### Selection

The selected entity gets a larger icon and a selection ring.

## Dispatch Incidents

Source: `buildDispatchLayer.ts`. Located incidents extracted from P25 dispatch audio.

- Shown when severity is 3 or higher, heard within the last 6 hours, and not cleared. Routine calls stay on the Incidents page.
- **Red** = life safety (severity 5+); **amber** = everything else significant. Icons fade with age.
- Anything heard in the last hour has a halo; life-safety incidents always keep a lighter-red halo.
- The glyph shows the kind: life safety (water rescue, rescue, violence, train/pedestrian struck), fire (structure, outside, vehicle, alarm), hazard (gas leak, CO, hazmat), traffic (crash), medical (medical, assault), other.
- Far (zoom < 8): small dot (9–11 px). Zoom 8 and closer: glyph (32–36 px).

## Events

Source: `buildEventLayers.ts`. Located events (earthquakes, GDACS disasters and similar) are drawn as translucent discs.

- Radius is magnitude x 5 km when a magnitude exists; otherwise 20 km (high), 10 km (medium), 5 km (low/other).
- Color by severity: red (high), amber (medium), cyan (low), grey (other). Fill and outline fade over 24 hours.
- Aircraft-role events are logged in the event feed only; the aircraft itself is already on the map.

## Lightning

Source: `buildLightningLayer.ts`

- Far: dot; mid: ring; close: lightning icon (18 px at mid and close)
- Yellow, fading with age; size fades over 30 seconds

A separate lightning-density overlay shows where strikes concentrate.

## Stream Gauges

Source: `buildStreamGaugeLayer.ts`

- Far: dot (7 px); mid: ring (10 px); close: stream icon (18 px)
- Stage colors: normal (light blue), action/elevated (yellow), minor flood (orange), moderate flood (red), major flood (dark red), stale / out of service / unknown (grey)

## Mesh Nodes

Source: `buildMeshNodeLayer.ts`

- Far: dot (8 px); mid: ring (12 px); close: mesh icon (20 px)
- Active: lime green; stale (no advert within `VITE_MESH_NODE_STALE_HOURS`): grey
- Node-to-node links are drawn as lines by the mesh links overlay

## Traffic Cameras

Source: `buildCameraLayer.ts`

- Far: dot (8 px); mid: ring (12 px); close: camera icon (22 px, selected 28 px)
- Amber, brighter when selected

## Receiver Range Ring

Source: `buildObservationRingLayer.ts`

A light-blue circle around the region center (`REGION_LAT`/`REGION_LON`) with radius `VITE_OBSERVATION_RANGE_KM` (default 50 km). Set it to `0` to hide the ring.

## Geofences

Source: `buildGeofenceLayers.ts`

- Alert: amber
- Exclusion: red
- Info: light blue
- Area: grey, label-only zones

## Trails and Predicted Path

Moving entities draw a history trail behind them. A dashed line ahead of the entity shows its predicted path.

## Map Overlays (MapLibre)

These raster and polygon layers sit beneath the entity layers and are toggled from the map layer controls:

- weather radar (reflectivity) and NOAA GOES satellite imagery (infrared and visible)
- smoke plume overlay
- NWS alert polygons
- wildfire perimeters (NIFC/WFIGS, refreshed about every 30 minutes) and ODF fire-danger levels
- power-outage areas
- rail lines
- region outlines and terrain
- drawn annotations and imported KML / GeoJSON layers

## Notes

- Operational indicators and anything updated live are Deck.gl layers; MapLibre carries the basemap, raster/weather tiles, terrain and native controls.
- Dense feeds do not show always-on labels; labels are zoom-gated.
