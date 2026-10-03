import { type Layer, type Position } from '@deck.gl/core'
import { PathLayer, LineLayer } from '@deck.gl/layers'
import { PathStyleExtension, type PathStyleExtensionProps } from '@deck.gl/extensions'
import type { Track } from '../store'
import { getDistanceMeters } from './geoUtils'
import { entityColor } from './colorUtils'
import { groupTracks, tierLayers } from './layerPriority'

const pos = (arr: number[]): Position => arr as unknown as Position
const posA = (arr: number[][]): Position[] => arr as unknown as Position[]
const DASH_EXTENSION = new PathStyleExtension({ dash: true })
type TrailPart = 'all' | 'history' | 'dynamic' | 'selected'
type GapBridge = { from: number[]; to: number[]; color: [number, number, number, number] }

function trailPath(t: Track): Position[] {
  return t.smoothedTrail.length >= 2 ? posA(t.smoothedTrail) : t.trail.map(p => pos([p[0], p[1]]))
}

function buildTrailTier(
  tracks: Record<string, Track>, selectedUid: string | null,
  trailsVisible: boolean, part: TrailPart,
): Layer[] {
  const out: Layer[] = []
  const want = (p: TrailPart) => part === 'all' || part === p
  const trackArr = Object.values(tracks)
  if (trailsVisible && want('history')) {
    const data = trackArr.filter(t => t.type !== 'rail' && t.uid !== selectedUid &&
      (t.smoothedTrail.length >= 2 || t.trail.length >= 2))
    if (data.length) out.push(new PathLayer<Track>({
      id: 'history-trails', data, getPath: trailPath, getColor: t => entityColor(t, 180),
      getWidth: 2.5, widthMinPixels: 1.5, widthUnits: 'pixels',
      jointRounded: true, capRounded: true, pickable: false,
    }))
  }
  if (trailsVisible && want('dynamic')) {
    const gaps: GapBridge[] = []
    for (const track of trackArr) {
      if (!track.smoothedTrail.length) continue
      const last = track.smoothedTrail[track.smoothedTrail.length - 1]
      const distance = getDistanceMeters(last[0], last[1], track.lon, track.lat)
      if (distance > 5 && distance < 15_000) gaps.push({
        from: last, to: [track.lon, track.lat], color: entityColor(track),
      })
    }
    if (gaps.length) out.push(new LineLayer<GapBridge>({
      id: 'trail-gap-bridge', data: gaps, getSourcePosition: d => pos(d.from),
      getTargetPosition: d => pos(d.to), getColor: d => d.color,
      getWidth: 3.5, widthMinPixels: 1, widthUnits: 'pixels', pickable: false,
    }))
    const predicted = trackArr.filter(t => t.predictedPath.length > 1 && t.type !== 'rail')
    if (predicted.length) out.push(new PathLayer<Track, PathStyleExtensionProps<Track>>({
      id: 'predicted-path', data: predicted,
      getPath: t => [pos([t.lon, t.lat]), ...posA(t.predictedPath)],
      getColor: t => entityColor(t, 160), getWidth: 2, widthMinPixels: 1,
      widthUnits: 'pixels', extensions: [DASH_EXTENSION],
      getDashArray: [6, 4], dashJustified: true, pickable: false,
    }))
  }
  const selected = selectedUid ? tracks[selectedUid] : undefined
  // Preserve the existing explicit selected TAK/train history exception.
  if (want('selected') && selected && (trailsVisible || selected.type === 'tak' || selected.type === 'rail') &&
      (selected.smoothedTrail.length >= 2 || selected.trail.length >= 2)) {
    out.push(new PathLayer<Track>({
      id: 'selected-trail', data: [selected], getPath: trailPath,
      getColor: t => entityColor(t, 255), getWidth: 3.5, widthMinPixels: 2,
      widthUnits: 'pixels', jointRounded: true, capRounded: true, pickable: false,
    }))
  }
  return out
}

export function buildTrailLayers(
  tracks: Record<string, Track>, selectedUid: string | null, trailsVisible: boolean,
  part: TrailPart = 'all',
): Layer[] {
  if (!trailsVisible) {
    if (part === 'history' || part === 'dynamic') return []
    const selected = selectedUid ? tracks[selectedUid] : undefined
    if (!selected || (selected.type !== 'tak' && selected.type !== 'rail')) return []
    tracks = { [selected.uid]: selected }
  }
  return Array.from(groupTracks(tracks), ([priority, group]) =>
    tierLayers(buildTrailTier(group, selectedUid, trailsVisible, part), priority),
  ).flat()
}
