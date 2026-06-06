import { Layer, type Position } from '@deck.gl/core'
import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Track } from '../store'
import { getAtlasIcons } from './atlasIcons'
import { entityColor } from './colorUtils'
import { DEPTH_OCCLUDE, DEPTH_ON_TOP, isOccludable } from './occlusion'

// deck.gl's Position is a @math.gl Vector; a plain number[] needs a double-cast.
const pos = (arr: number[]): Position => arr as unknown as Position

// Zoom bucket helpers — mirrors the Atlas spec (FULL >= 9 / RING 6-8 / DOT < 6).
function iconForZoom(fullName: string, zoom: number): string {
  if (zoom >= 9) return fullName
  if (zoom >= 6) return 'ring'
  return 'dot'
}

function entityIconSize(selectedUid: string | null, track: Track, zoom: number): number {
  if (zoom < 6) return 8
  if (zoom < 9) {
    // Keep ADSB/AIS at full icon-layer size in mid zoom.
    if (track.type === 'air' || track.type === 'sea') {
      return track.uid === selectedUid ? 40 : 32
    }
    return 10
  }
  if (track.type === 'ground') {
    return track.uid === selectedUid ? 30 : 24
  }
  if (track.type === 'rail') {
    return track.uid === selectedUid ? 36 : 28
  }
  return track.uid === selectedUid ? 40 : 32
}

const TAK_ICON_COLOR: [number, number, number, number] = [0, 230, 180, 240]   // teal — friendly ground
const TRAIN_ICON_COLOR: [number, number, number, number] = [255, 193, 7, 240]   // amber — Amtrak rail

function aprsColor(stationType: string | undefined): [number, number, number, number] {
  switch (stationType) {
    case 'emergency':      return [255,  80,  80, 255]
    case 'weather':        return [100, 200, 255, 230]
    case 'infrastructure': return [180, 100, 255, 230]
    case 'aircraft':       return [  0, 230, 255, 230]
    case 'marine':         return [  0, 120, 255, 230]
    case 'fixed':          return [100, 180, 100, 200]
    default:               return [179, 136, 255, 230]  // mobile / unknown
  }
}

// ─── buildEntityLayers ────────────────────────────────────────────────────────
// Returns: [selectionRingLayer, iconLayer, labelLayer]
export function buildEntityLayers(
  tracks: Record<string, Track>,
  selectedUid: string | null,
  cycle: number,
  zoom: number,
  tagColorMap?: Record<string, [number, number, number, number]>,
  threeD = false,
): Layer[] {
  const atlas    = getAtlasIcons()
  const trackArr = Object.values(tracks)

  const selectedTrack = selectedUid ? tracks[selectedUid] : undefined

  const selectionRingLayer = new ScatterplotLayer<Track>({
    id:             'selection-ring',
    data:           selectedTrack ? [selectedTrack] : [],
    getPosition:    (t) => [t.lon, t.lat],
    getRadius:      () => 30 + cycle * 40,
    getFillColor:   (t) => {
      const [r, g, b] = entityColor(t)
      return [r, g, b, Math.round(255 * (1 - cycle * cycle))]
    },
    getLineColor:   (t) => {
      const [r, g, b] = entityColor(t)
      return [r, g, b, Math.round(255 * (1 - cycle * cycle))]
    },
    radiusUnits:    'pixels',
    stroked:        true,
    filled:         false,
    getLineWidth:   2,
    lineWidthUnits: 'pixels',
  })

  // Design-guide color for fire_incident: --cat-fire #FF5252
  const FIRE_ICON_COLOR: [number, number, number, number] = [255, 82, 82, 230]
  const RF_SENSOR_COLOR: [number, number, number, number] = [118, 221, 0, 220]

  const baseIcon = (t: Track) =>
    t.type === 'sea'    ? 'vessel'
    : t.type === 'ground' ? 'aprs'
    : t.type === 'hazard' ? 'fire'
    : t.type === 'tak'    ? 'tak_client'
    : t.type === 'rail'   ? 'train'
    : t.type === 'sensor' ? 'rf_sensor'
    : 'aircraft'

  const getIconFor = (t: Track) => {
    const icon = baseIcon(t)
    if (zoom >= 9) return icon
    if (zoom >= 6) {
      // Keep ADSB (air), AIS (sea), TAK clients, and trains as full icons at mid zoom.
      if (t.type === 'air' || t.type === 'sea' || t.type === 'tak' || t.type === 'rail') return icon
      return 'dot'
    }
    return 'dot'
  }

  const getIconColor = (t: Track): [number, number, number, number] => {
    if (t.type === 'ground')  return aprsColor(t.stationType)
    if (t.type === 'tak')     return TAK_ICON_COLOR
    if (t.type === 'hazard')  return FIRE_ICON_COLOR
    if (t.type === 'rail')    return tagColorMap?.[t.uid] ?? TRAIN_ICON_COLOR
    if (t.type === 'sensor')  return RF_SENSOR_COLOR
    return tagColorMap?.[t.uid] ?? entityColor(t)
  }

  // In 3-D mode aircraft fly at their true altitude (so ridges occlude low
  // traffic) and everything occludable shares the terrain depth buffer. Land
  // markers and labels stay on top regardless. In flat mode a single bucket
  // holds every track exactly as before.
  const getIconPosition = (t: Track): Position =>
    pos(threeD && t.type === 'air' ? [t.lon, t.lat, t.altMeters] : [t.lon, t.lat])

  // Build an outline+icon pair for a subset of tracks. `idSuffix` keeps the
  // pickable layer id stable as 'entity-icons' for the on-top bucket so the
  // tooltip/click bridge keeps working; the occluded bucket adds its own id.
  function iconPair(data: Track[], occlude: boolean, idSuffix: string): IconLayer<Track>[] {
    const parameters = occlude ? DEPTH_OCCLUDE : DEPTH_ON_TOP
    const outline = new IconLayer<Track>({
      id:          `entity-icons-outline${idSuffix}`,
      data,
      iconAtlas:   atlas.url,
      iconMapping: atlas.mapping,
      getIcon:     getIconFor,
      getPosition: getIconPosition,
      getAngle:    (t) => -t.courseTrue,
      getColor:    [15, 23, 42, 220], // Slate-900 with high alpha for contrast
      getSize:     (t) => entityIconSize(selectedUid, t, zoom) + 2.5,
      sizeUnits:   'pixels',
      billboard:   false,
      pickable:    false, // Only the top layer needs to be pickable
      parameters,
      updateTriggers: {
        getIcon:     zoom,
        getPosition: threeD,
        getAngle:    data.map(t => t.courseTrue),
        getSize:     [selectedUid, zoom],
      },
    })
    const icon = new IconLayer<Track>({
      id:          `entity-icons${idSuffix}`,
      data,
      iconAtlas:   atlas.url,
      iconMapping: atlas.mapping,
      getIcon:     getIconFor,
      getPosition: getIconPosition,
      getAngle:    (t) => -t.courseTrue,
      getColor:    getIconColor,
      getSize:     (t) => entityIconSize(selectedUid, t, zoom),
      sizeUnits:   'pixels',
      billboard:   false,
      pickable:    true,
      parameters,
      updateTriggers: {
        getIcon:     zoom,
        getPosition: threeD,
        getAngle:    data.map(t => t.courseTrue),
        getColor:    data.map(t => tagColorMap?.[t.uid]?.join(',') ?? `${t.altMeters + t.speedMs}${t.stationType ?? ''}`),
        getSize:     [selectedUid, zoom],
      },
    })
    return [outline, icon]
  }

  // In 3-D, peel air/sea into a depth-tested bucket; the rest stay on top.
  const onTopData    = threeD ? trackArr.filter(t => !isOccludable(t.type)) : trackArr
  const occludedData = threeD ? trackArr.filter(t =>  isOccludable(t.type)) : []
  const iconLayers: IconLayer<Track>[] = [
    ...iconPair(onTopData, false, ''),
    ...(occludedData.length ? iconPair(occludedData, true, '-occluded') : []),
  ]

  // Pulsing red ring for APRS emergency stations.
  const emergencyAprs = trackArr.filter(t => t.type === 'ground' && t.stationType === 'emergency')
  const emergencyRingLayer = new ScatterplotLayer<Track>({
    id:             'aprs-emergency-rings',
    data:           emergencyAprs,
    getPosition:    (t) => [t.lon, t.lat],
    getRadius:      () => 20 + cycle * 30,
    getFillColor:   () => [255, 80, 80, Math.round(140 * (1 - cycle * cycle))],
    getLineColor:   () => [255, 80, 80, Math.round(255 * (1 - cycle * cycle))],
    radiusUnits:    'pixels',
    stroked:        true,
    filled:         true,
    getLineWidth:   2,
    lineWidthUnits: 'pixels',
    updateTriggers: { getRadius: cycle, getFillColor: cycle, getLineColor: cycle },
  })

  // APRS labels: show at z10+, color matches station type
  const aprsLabelLayer = new TextLayer<Track>({
    id: 'aprs-labels',
    data: zoom >= 10 ? trackArr.filter((t) => t.type === 'ground') : [],
    getPosition: (t) => [t.lon, t.lat],
    getText: (t) => t.callsign ?? t.uid,
    getSize: 10,
    sizeUnits: 'pixels',
    getColor: (t) => {
      const [r, g, b] = aprsColor(t.stationType)
      return [r, g, b, 220]
    },
    getPixelOffset: [0, 12],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    fontFamily: 'monospace',
    updateTriggers: {
      getColor: trackArr.map(t => t.stationType ?? ''),
    },
  })

  // TAK client labels: show at z9+ with teal tint
  const takLabelLayer = new TextLayer<Track>({
    id: 'tak-labels',
    data: zoom >= 9 ? trackArr.filter((t) => t.type === 'tak') : [],
    getPosition: (t) => [t.lon, t.lat],
    getText: (t) => t.callsign ?? t.uid,
    getSize: 11,
    sizeUnits: 'pixels',
    getColor: TAK_ICON_COLOR,
    getPixelOffset: [0, 14],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    fontFamily: 'monospace',
  })

  // RF sensor labels: show at z10+ with lime tint
  const sensorLabelLayer = new TextLayer<Track>({
    id: 'rf-sensor-labels',
    data: zoom >= 10 ? trackArr.filter((t) => t.type === 'sensor') : [],
    getPosition: (t) => [t.lon, t.lat],
    getText: (t) => t.callsign ?? t.uid,
    getSize: 10,
    sizeUnits: 'pixels',
    getColor: RF_SENSOR_COLOR,
    getPixelOffset: [0, 14],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    fontFamily: 'monospace',
  })

  return [selectionRingLayer, emergencyRingLayer, ...iconLayers, aprsLabelLayer, takLabelLayer, sensorLabelLayer]
}
