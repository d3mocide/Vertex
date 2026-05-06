import { ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../store'

export interface MeshNodePoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  stale: boolean
  status: string
}

const STALE_MS = 10 * 60 * 1000

function toMeshNodePoint(e: Entity, nowMs: number): MeshNodePoint | null {
  if (e.entity_type !== 'mesh_node' || e.lat == null || e.lon == null) return null
  const lastMs = e.last_seen ? Date.parse(e.last_seen) : 0
  const stale = !lastMs || (nowMs - lastMs > STALE_MS)
  return {
    entity_id: e.entity_id,
    name: e.display_name ?? e.entity_id,
    lon: e.lon,
    lat: e.lat,
    stale,
    status: e.status ?? '',
  }
}

export function buildMeshNodeLayers(entities: Entity[], visible: boolean, nowMs: number) {
  if (!visible) return []
  const points = entities
    .map((e) => toMeshNodePoint(e, nowMs))
    .filter((p): p is MeshNodePoint => p !== null)

  if (points.length === 0) return []

  const ring = new ScatterplotLayer<MeshNodePoint>({
    id: 'mesh-node-ring',
    data: points,
    pickable: false,
    filled: true,
    stroked: false,
    radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 9,
    getFillColor: (p) => (p.stale ? [85, 85, 85, 85] : [26, 150, 65, 90]),
  })

  const dots = new ScatterplotLayer<MeshNodePoint>({
    id: 'mesh-node-dots',
    data: points,
    pickable: true,
    filled: true,
    stroked: true,
    radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 5,
    getFillColor: (p) => (p.stale ? [136, 136, 136, 230] : [77, 172, 38, 240]),
    getLineColor: [255, 255, 255, 255],
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
  })

  return [ring, dots]
}
