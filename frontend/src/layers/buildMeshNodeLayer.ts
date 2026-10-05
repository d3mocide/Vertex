import { IconLayer } from '@deck.gl/layers'
import type { Entity } from '../store'
import { getAtlasIcons } from './atlasIcons'
import { MESH_NODE_STALE_MS } from '../config'
import { lift, terrainVersion } from './terrainElevation'

export interface MeshNodePoint {
  entity_id: string
  name: string
  lon: number
  lat: number
  stale: boolean
  status: string
}

// Atlas hue: lime-rf #76DD00 — mesh is RF infrastructure; orange is P25/dispatch
const MESH_ACTIVE: [number, number, number, number] = [118, 221,   0, 240]
const MESH_STALE:  [number, number, number, number] = [136, 136, 136, 200]

function toMeshNodePoint(e: Entity, nowMs: number): MeshNodePoint | null {
  if (e.entity_type !== 'mesh_node' || e.lat == null || e.lon == null) return null
  const lastMs = e.last_seen ? Date.parse(e.last_seen) : 0
  const stale  = !lastMs || (nowMs - lastMs > MESH_NODE_STALE_MS)
  return {
    entity_id: e.entity_id,
    name:   e.display_name ?? e.entity_id,
    lon: e.lon, lat: e.lat,
    stale,
    status: e.status ?? '',
  }
}

function iconForZoom(zoom: number): string {
  if (zoom >= 9) return 'mesh'
  if (zoom >= 6) return 'ring-3'
  return 'dot'
}

function iconSize(zoom: number): number {
  if (zoom >= 9) return 20
  if (zoom >= 6) return 12
  return 8
}

export function buildMeshNodeLayers(
  entities: Entity[], visible: boolean, nowMs: number, zoom: number, staleEpoch: number,
) {
  if (!visible) return []
  const points = entities
    .map((e) => toMeshNodePoint(e, nowMs))
    .filter((p): p is MeshNodePoint => p !== null)

  if (points.length === 0) return []

  const atlas = getAtlasIcons()

  // Icon layer — pickable, hex shape degrades with zoom bucket.
  const icon = new IconLayer<MeshNodePoint>({
    id:          'mesh-node-dots',   // id kept for tooltip + click handler compat
    data:        points,
    pickable:    true,
    iconAtlas:   atlas.url,
    iconMapping: atlas.mapping,
    getIcon:     () => iconForZoom(zoom),
    getPosition: (p) => lift(p.lon, p.lat),
    getSize:     () => iconSize(zoom),
    getColor:    (p) => p.stale ? MESH_STALE : MESH_ACTIVE,
    sizeUnits:   'pixels',
    billboard:   false,
    updateTriggers: { getPosition: terrainVersion(),
      getIcon:  zoom,
      getSize:  zoom,
      // Scalar trigger: an array here is a new object every build, so deck
      // always recomputed colours. Staleness only changes as time passes.
      getColor: staleEpoch,
    },
  })

  return [icon]
}
