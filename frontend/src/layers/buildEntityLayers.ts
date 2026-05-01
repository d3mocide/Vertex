import { Layer, type LayerContext } from '@deck.gl/core'
import { IconLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Track } from '../store'
import { getIconAtlas } from './iconAtlas'
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

const HALO_TYPES = new Set(['SAR', 'MIL', 'HEL', 'UAV', 'GOV'])

// ─── buildEntityLayers ────────────────────────────────────────────────────────
// Returns: [haloLayer, selectionRingLayer, iconLayer]
export function buildEntityLayers(
  tracks: Record<string, Track>,
  selectedUid: string | null,
  cycle: number,
): Layer[] {
  const atlas    = getIconAtlas()
  const trackArr = Object.values(tracks)

  const haloLayer = new IconLayer<Track>({
    id:          'entity-halos',
    data:        trackArr.filter(t => HALO_TYPES.has(t.category ?? '')),
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     () => 'halo',
    getPosition: (t) => [t.lon, t.lat],
    getSize:     () => 52,
    getColor:    () => [255, 136, 0, 140],
    sizeUnits:   'pixels',
    billboard:   false,
  })

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

  const iconLayer = new IconLayer<Track>({
    id:          'entity-icons',
    data:        trackArr,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     (t) => t.type === 'sea' ? 'vessel' : t.type === 'ground' ? 'aprs' : t.type === 'hazard' ? 'fire' : 'aircraft',
    getPosition: (t) => [t.lon, t.lat],
    getAngle:    (t) => -t.courseTrue,
    getColor:    (t) => entityColor(t),
    getSize:     (t) => t.uid === selectedUid ? 40 : 32,
    sizeUnits:   'pixels',
    billboard:   false,
    pickable:    true,
    updateTriggers: {
      getAngle: trackArr.map(t => t.courseTrue),
      getColor: trackArr.map(t => t.altMeters + t.speedMs),
      getSize:  selectedUid,
    },
  })

  const aprsLabelLayer = new TextLayer<Track>({
    id: 'aprs-labels',
    data: trackArr.filter((t) => t.type === 'ground'),
    getPosition: (t) => [t.lon, t.lat],
    getText: (t) => t.callsign ?? t.uid,
    getSize: 10,
    sizeUnits: 'pixels',
    getColor: [180, 255, 255, 220],
    getPixelOffset: [0, 12],
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'top',
    fontFamily: 'monospace',
  })

  return [haloLayer, selectionRingLayer, iconLayer, aprsLabelLayer]
}
