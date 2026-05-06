import { IconLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Entity } from '../store'
import { getAtlasIcons } from './atlasIcons'

export interface MeshNodePoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  stale: boolean
  status: string
}

const STALE_MS = 10 * 60 * 1000

// Atlas hue: --cat-mesh #FF8F00
const MESH_ACTIVE: [number, number, number, number] = [255, 143,   0, 240]
const MESH_STALE:  [number, number, number, number] = [136, 136, 136, 200]

function toMeshNodePoint(e: Entity, nowMs: number): MeshNodePoint | null {
  if (e.entity_type !== 'mesh_node' || e.lat == null || e.lon == null) return null
  const lastMs = e.last_seen ? Date.parse(e.last_seen) : 0
  const stale  = !lastMs || (nowMs - lastMs > STALE_MS)
  return {
    entity_id: e.entity_id,
    name:   e.display_name ?? e.entity_id,
    lon: e.lon, lat: e.lat,
    stale,
    status: e.status ?? '',
  }
}

function iconForZoom(zoom: number): string {
  if (zoom >= 11) return 'mesh'
  if (zoom >= 8)  return 'ring'
  return 'dot'
}

function iconSize(zoom: number): number {
  if (zoom >= 11) return 20
  if (zoom >= 8)  return 12
  return 6
}

export function buildMeshNodeLayers(entities: Entity[], visible: boolean, nowMs: number, zoom: number) {
  if (!visible) return []
  const points = entities
    .map((e) => toMeshNodePoint(e, nowMs))
    .filter((p): p is MeshNodePoint => p !== null)

  if (points.length === 0) return []

  const atlas = getAtlasIcons()

  // Ambient glow ring — non-pickable, sits behind the icon.
  const ring = new ScatterplotLayer<MeshNodePoint>({
    id:          'mesh-node-ring',
    data:        points,
    pickable:    false,
    filled:      true,
    stroked:     false,
    radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius:   zoom >= 11 ? 13 : zoom >= 8 ? 9 : 5,
    getFillColor:(p) => p.stale
      ? [85, 85, 85, 70]
      : [255, 143, 0, 70],
    updateTriggers: { getRadius: zoom },
  })

  // Icon layer — pickable, hex shape degrades with zoom bucket.
  const icon = new IconLayer<MeshNodePoint>({
    id:          'mesh-node-dots',   // id kept for tooltip + click handler compat
    data:        points,
    pickable:    true,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     () => iconForZoom(zoom),
    getPosition: (p) => [p.lon, p.lat],
    getSize:     () => iconSize(zoom),
    getColor:    (p) => p.stale ? MESH_STALE : MESH_ACTIVE,
    sizeUnits:   'pixels',
    billboard:   false,
    updateTriggers: {
      getIcon:  zoom,
      getSize:  zoom,
      getColor: points.map(p => p.stale),
    },
  })

  return [ring, icon]
}
