import { IconLayer } from '@deck.gl/layers'
import type { Entity } from '../store'
import { getAtlasIcons } from './atlasIcons'

export interface StreamGaugePoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  flow_cfs: number | null
  height_ft: number | null
  stage: string
  color: [number, number, number, number]
}

const STAGE_COLOR: Record<string, [number, number, number, number]> = {
  normal:          [79,  195, 247, 255],   // atlas --cat-stream #4FC3F7
  elevated:        [255, 241, 118, 255],
  'minor flood':   [255, 183,  77, 255],
  'moderate flood':[239,  83,  80, 255],
  'major flood':   [183,  28,  28, 255],
  unknown:         [144, 164, 174, 255],
}

function toGaugePoint(e: Entity): StreamGaugePoint | null {
  if (e.lat == null || e.lon == null) return null
  const ident = (e.identity ?? {}) as Record<string, unknown>
  const flow   = typeof ident.flow_cfs   === 'number' ? ident.flow_cfs   : null
  const height = typeof ident.height_ft  === 'number' ? ident.height_ft  : null
  const stage  = typeof ident.stage      === 'string' ? ident.stage      : 'unknown'
  return {
    entity_id: e.entity_id,
    name:      e.display_name ?? e.entity_id,
    lon: e.lon, lat: e.lat,
    flow_cfs: flow, height_ft: height,
    stage,
    color: STAGE_COLOR[stage] ?? STAGE_COLOR.unknown,
  }
}

// Zoom bucket sizes matching Atlas spec.
function gaugeIconSize(zoom: number): number {
  if (zoom >= 9) return 18
  if (zoom >= 6) return 10
  return 7
}

function gaugeIconName(zoom: number): string {
  if (zoom >= 9) return 'stream'
  if (zoom >= 6) return 'ring'
  return 'dot'
}

export function buildStreamGaugeLayers(entities: Entity[], visible: boolean, zoom: number) {
  if (!visible) return []
  const points = entities
    .filter((e) => e.entity_type === 'stream_gauge')
    .map(toGaugePoint)
    .filter((p): p is StreamGaugePoint => p !== null)

  if (points.length === 0) return []

  const atlas = getAtlasIcons()

  // Icon layer — pickable, switches shape with zoom bucket.
  const icon = new IconLayer<StreamGaugePoint>({
    id:          'stream-gauge-dots',   // id kept for tooltip + click handler compat
    data:        points,
    pickable:    true,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     () => gaugeIconName(zoom),
    getPosition: (p) => [p.lon, p.lat],
    getSize:     () => gaugeIconSize(zoom),
    getColor:    (p) => p.color,
    sizeUnits:   'pixels',
    billboard:   false,
    updateTriggers: {
      getIcon:  zoom,
      getSize:  zoom,
      getColor: points.map(p => p.stage),
    },
  })

  return [icon]
}
