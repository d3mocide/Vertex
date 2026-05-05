import { ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Track } from '../store'

export interface ClusterCell {
  lon: number
  lat: number
  count: number
  air: number
  sea: number
  ground: number
}

const CLUSTER_ZOOM_THRESHOLD = 8   // below this zoom, show clusters

// Grid cell size in degrees — coarser at lower zoom, finer at higher.
// At zoom 7 (~1300km viewport): 2° cells
// At zoom 6 (~2600km viewport): 4° cells
function gridSize(zoom: number): number {
  return Math.pow(2, Math.max(0, 10 - Math.round(zoom)))
}

export function computeClusters(tracks: Record<string, Track>, zoom: number): ClusterCell[] {
  const g = gridSize(zoom)
  const cells = new Map<string, ClusterCell>()

  for (const t of Object.values(tracks)) {
    const cx = Math.floor(t.lon / g) * g + g / 2
    const cy = Math.floor(t.lat / g) * g + g / 2
    const key = `${cx.toFixed(4)},${cy.toFixed(4)}`

    let cell = cells.get(key)
    if (!cell) {
      cell = { lon: cx, lat: cy, count: 0, air: 0, sea: 0, ground: 0 }
      cells.set(key, cell)
    }
    cell.count++
    if (t.type === 'air')    cell.air++
    if (t.type === 'sea')    cell.sea++
    if (t.type === 'ground') cell.ground++
  }

  return Array.from(cells.values())
}

// Dominant type color for a cluster cell
function clusterColor(cell: ClusterCell): [number, number, number, number] {
  if (cell.air >= cell.sea && cell.air >= cell.ground) return [100, 160, 255, 210]  // blue-air
  if (cell.sea >= cell.ground) return [0, 200, 160, 210]  // teal-sea
  return [255, 200, 80, 210]  // amber-ground
}

export function buildClusterLayers(tracks: Record<string, Track>, zoom: number) {
  if (zoom >= CLUSTER_ZOOM_THRESHOLD) return []

  const clusters = computeClusters(tracks, zoom)
  if (clusters.length === 0) return []

  const scatter = new ScatterplotLayer<ClusterCell>({
    id:          'entity-clusters',
    data:        clusters,
    pickable:    false,
    stroked:     true,
    filled:      true,
    radiusUnits: 'pixels',
    getPosition: (c) => [c.lon, c.lat],
    getRadius:   (c) => Math.max(16, Math.min(40, 14 + Math.sqrt(c.count) * 3)),
    getFillColor:  (c) => { const [r, g, b, a] = clusterColor(c); return [r, g, b, Math.round(a * 0.4)] },
    getLineColor:  (c) => clusterColor(c),
    getLineWidth:  () => 1.5,
    lineWidthUnits:'pixels',
  })

  const labels = new TextLayer<ClusterCell>({
    id:          'entity-cluster-labels',
    data:        clusters,
    getPosition: (c) => [c.lon, c.lat],
    getText:     (c) => String(c.count),
    getSize:     10,
    sizeUnits:   'pixels',
    getColor:    [255, 255, 255, 230],
    getTextAnchor:        'middle',
    getAlignmentBaseline: 'center',
    fontFamily:  'monospace',
    fontWeight:  'bold',
  })

  return [scatter, labels]
}

export { CLUSTER_ZOOM_THRESHOLD }
