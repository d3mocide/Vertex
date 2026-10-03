import type { Layer } from '@deck.gl/core'
import type { Track } from '../store'

// Higher numbers draw later. Entity paths and symbols share these tiers.
export function trackPriority(track: Track): number {
  switch (track.type) {
    case 'air': return 100
    case 'hazard': return 80
    case 'ground': return track.stationType === 'emergency' ? 80 : 70
    case 'tak': return 70
    case 'sea': return 60
    case 'rail': return 51
    case 'bus': return 50
    case 'sensor': return 40
  }
}

export function groupTracks(tracks: Record<string, Track>): Map<number, Record<string, Track>> {
  const groups = new Map<number, Record<string, Track>>()
  for (const track of Object.values(tracks)) {
    const priority = trackPriority(track)
    let group = groups.get(priority)
    if (!group) { group = {}; groups.set(priority, group) }
    group[track.uid] = track
  }
  return groups
}

export function tierLayers(layers: Layer[], priority: number): Layer[] {
  return layers.map(layer => layer.clone({ id: `${layer.id}::${priority}` }))
}

function layerRank(layer: Layer): number {
  const [id, tier] = layer.id.split('::')
  const priority = tier ? Number(tier) :
    id.startsWith('dispatch-') ? 90 :
    id === 'event-points' || id === 'lightning-strikes' ? 80 :
    id.startsWith('mesh-node') || id.startsWith('stream-gauge') || id === 'camera-points' ? 40 :
    id === 'annotation-marker' || id === 'annotation-label' || id.startsWith('custom-point') ? 30 :
    id === 'annotation-line' || id.startsWith('custom-line') || id.startsWith('selected-transit-route') ? 20 : 10
  const withinTier = id === 'history-trails' ? 0 :
    id === 'trail-gap-bridge' || id === 'predicted-path' ? 1 :
    id === 'selected-trail' ? 2 : 3
  return priority * 10 + withinTier
}

export function orderOperationalLayers(layers: Layer[]): Layer[] {
  // Stable sort preserves glow/outline/icon/label order within each builder.
  return layers.sort((a, b) => layerRank(a) - layerRank(b))
}
