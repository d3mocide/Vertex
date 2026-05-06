# Map Key

This page describes how map symbols render in Vertex by zoom level and signal type.

## Last Updated From Code

- Date: 2026-05-06
- Intent: Keep this page synchronized with rendering rules in the frontend layer builders.
- Primary source files:
  - frontend/src/layers/buildEntityLayers.ts
  - frontend/src/layers/buildLightningLayer.ts
  - frontend/src/layers/buildStreamGaugeLayer.ts
  - frontend/src/layers/buildMeshNodeLayer.ts
  - frontend/src/layers/buildCameraLayer.ts
  - frontend/src/layers/colorUtils.ts

If map symbol behavior changes, update this document in the same change set.

## Zoom Buckets

- Far: zoom < 6
- Mid: zoom 6 to 8
- Close: zoom >= 9

## Entity Layer (ADSB, AIS, APRS, Fire/Hazard)

Entity layer source: frontend/src/layers/buildEntityLayers.ts

### Icon behavior

- ADSB (air)
  - Far: dot
  - Mid: aircraft (full icon)
  - Close: aircraft (full icon)
- AIS (sea)
  - Far: dot
  - Mid: vessel (full icon)
  - Close: vessel (full icon)
- APRS (ground)
  - Far: dot
  - Mid: dot
  - Close: aprs (full icon)
- Hazard
  - Far: dot
  - Mid: dot
  - Close: fire (full icon)

### Icon sizes

- Far: 8 px
- Mid:
  - ADSB/AIS:
    - Default: 32 px
    - Selected: 40 px
  - APRS/Hazard: 10 px
- Close:
  - Default: 32 px
  - Selected: 40 px

### Colors

- APRS icon: rgba(179, 136, 255, 230) (atlas violet)
- Non-APRS entity colors: mission tag color (if present), otherwise dynamic altitude/speed gradient from frontend/src/layers/colorUtils.ts

### Labels

- APRS labels are shown at zoom >= 10
- APRS label color: rgba(179, 136, 255, 220)

## Lightning Layer

Layer source: frontend/src/layers/buildLightningLayer.ts

### Icon behavior

- Far: dot
- Mid: ring
- Close: lightning (full icon)

### Base icon sizes

- Far: 8 px
- Mid: 18 px
- Close: 18 px

Final rendered size fades by strike age over 30 seconds.

### Color

- Base hue: rgb(255, 233, 77)
- Alpha fades with age

## Stream Gauge Layer

Layer source: frontend/src/layers/buildStreamGaugeLayer.ts

### Icon behavior

- Far: dot
- Mid: ring
- Close: stream (full icon)

### Sizes

- Far: 8 px
- Mid: 12 px
- Close: 22 px

### Stage colors

- normal: rgba(79, 195, 247, 255)
- elevated: rgba(255, 241, 118, 255)
- minor flood: rgba(255, 183, 77, 255)
- moderate flood: rgba(239, 83, 80, 255)
- major flood: rgba(183, 28, 28, 255)
- unknown: rgba(144, 164, 174, 255)

## Mesh Node Layer

Layer source: frontend/src/layers/buildMeshNodeLayer.ts

### Icon behavior

- Far: dot
- Mid: ring
- Close: mesh (full icon)

### Sizes

- Far: 8 px
- Mid: 12 px
- Close: 20 px

### Colors

- Active: rgba(255, 143, 0, 240)
- Stale: rgba(136, 136, 136, 200)

## Camera Layer

Layer source: frontend/src/layers/buildCameraLayer.ts

### Icon behavior

- Far: dot
- Mid: ring
- Close: camera (full icon)

### Sizes

- Far: 8 px
- Mid: 12 px
- Close:
  - Default: 22 px
  - Selected: 28 px

### Colors

- Default: rgba(255, 184, 0, 200)
- Selected: rgba(255, 184, 0, 255)

## Notes

- Halo and glow layers are disabled for icon clarity.
- Selection pulse ring remains enabled for currently selected entities.