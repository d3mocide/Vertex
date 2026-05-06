import { ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../store'

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
  normal: [79, 195, 247, 255],
  elevated: [255, 241, 118, 255],
  'minor flood': [255, 183, 77, 255],
  'moderate flood': [239, 83, 80, 255],
  'major flood': [183, 28, 28, 255],
  unknown: [144, 164, 174, 255],
}

function toGaugePoint(e: Entity): StreamGaugePoint | null {
  if (e.lat == null || e.lon == null) return null
  const ident = (e.identity ?? {}) as Record<string, unknown>
  const flow = typeof ident.flow_cfs === 'number' ? ident.flow_cfs : null
  const height = typeof ident.height_ft === 'number' ? ident.height_ft : null
  const stage = typeof ident.stage === 'string' ? ident.stage : 'unknown'
  const color = STAGE_COLOR[stage] ?? STAGE_COLOR.unknown

  return {
    entity_id: e.entity_id,
    name: e.display_name ?? e.entity_id,
    lon: e.lon,
    lat: e.lat,
    flow_cfs: flow,
    height_ft: height,
    stage,
    color,
  }
}

export function buildStreamGaugeLayers(entities: Entity[], visible: boolean) {
  if (!visible) return []
  const points = entities
    .filter((e) => e.entity_type === 'stream_gauge')
    .map(toGaugePoint)
    .filter((p): p is StreamGaugePoint => p !== null)

  if (points.length === 0) return []

  const ring = new ScatterplotLayer<StreamGaugePoint>({
    id: 'stream-gauge-ring',
    data: points,
    pickable: false,
    filled: true,
    stroked: false,
    radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 14,
    getFillColor: (p) => [p.color[0], p.color[1], p.color[2], 120],
  })

  const dots = new ScatterplotLayer<StreamGaugePoint>({
    id: 'stream-gauge-dots',
    data: points,
    pickable: true,
    filled: true,
    stroked: true,
    radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 7,
    getFillColor: (p) => p.color,
    getLineColor: [255, 255, 255, 255],
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
  })

  return [ring, dots]
}
