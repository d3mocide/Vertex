import { Layer, type LayerContext } from '@deck.gl/core'
import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Track } from '../store'
import { getAtlasIcons } from './atlasIcons'
import { entityColor } from './colorUtils'

// ─── StencilClearLayer ────────────────────────────────────────────────────────
// Clears MapLibre tile stencil buffer bleed before deck.gl draws.
export class StencilClearLayer extends Layer {
  static layerName = 'StencilClearLayer'

  initializeState(_context: LayerContext): void {}

  // DrawOptions carries context: LayerContext which exposes gl (deprecated but present in v9)
  draw(opts: Parameters<Layer['draw']>[0]): void {
    const { gl } = opts.context
    gl.disable(gl.STENCIL_TEST)
    gl.stencilMask(0xff)
    gl.clear(gl.STENCIL_BUFFER_BIT)
  }

  renderLayers() { return [] }
}

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
  return track.uid === selectedUid ? 40 : 32
}

const APRS_ICON_COLOR: [number, number, number, number] = [179, 136, 255, 230]

// ─── buildEntityLayers ────────────────────────────────────────────────────────
// Returns: [selectionRingLayer, iconLayer, labelLayer]
export function buildEntityLayers(
  tracks: Record<string, Track>,
  selectedUid: string | null,
  cycle: number,
  zoom: number,
  tagColorMap?: Record<string, [number, number, number, number]>,
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

  const baseIcon = (t: Track) =>
    t.type === 'sea'    ? 'vessel'
    : t.type === 'ground' ? 'aprs'
    : t.type === 'hazard' ? 'fire'
    : 'aircraft'

  const iconLayer = new IconLayer<Track>({
    id:          'entity-icons',
    data:        trackArr,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     (t) => {
      const icon = baseIcon(t)
      if (zoom >= 9) return icon
      if (zoom >= 6) {
        // Keep ADSB (air) and AIS (sea) as full icons at mid zoom.
        if (t.type === 'air' || t.type === 'sea') return icon
        return 'dot'
      }
      return 'dot'
    },
    getPosition: (t) => [t.lon, t.lat],
    getAngle:    (t) => -t.courseTrue,
    getColor:    (t) => {
      if (t.type === 'ground') return APRS_ICON_COLOR
      return tagColorMap?.[t.uid] ?? entityColor(t)
    },
    getSize:     (t) => entityIconSize(selectedUid, t, zoom),
    sizeUnits:   'pixels',
    billboard:   false,
    pickable:    true,
    updateTriggers: {
      getIcon:  zoom,
      getAngle: trackArr.map(t => t.courseTrue),
      getColor: trackArr.map(t => tagColorMap?.[t.uid]?.join(',') ?? `${t.altMeters + t.speedMs}`),
      getSize:  [selectedUid, zoom],
    },
  })

  // APRS labels: show at z10+ with atlas violet tint
  const aprsLabelLayer = new TextLayer<Track>({
    id: 'aprs-labels',
    data: zoom >= 10 ? trackArr.filter((t) => t.type === 'ground') : [],
    getPosition: (t) => [t.lon, t.lat],
    getText: (t) => t.callsign ?? t.uid,
    getSize: 10,
    sizeUnits: 'pixels',
    getColor: [179, 136, 255, 220],   // atlas --cat-aprs #B388FF
    getPixelOffset: [0, 12],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    fontFamily: 'monospace',
  })

  return [selectionRingLayer, iconLayer, aprsLabelLayer]
}
