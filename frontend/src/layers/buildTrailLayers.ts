import { Layer, type Position } from '@deck.gl/core'
import { PathLayer, LineLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Track } from '../store'
import { getDistanceMeters } from './geoUtils'
import { entityColor } from './colorUtils'
import { DEPTH_OCCLUDE } from './occlusion'

// deck.gl's Position is a @math.gl Vector (Float64Array-based), so plain number[]
// needs a double-cast when passing to typed accessors.
const pos  = (arr: number[]): Position   => arr as unknown as Position
const posA = (arr: number[][]): Position[] => arr as unknown as Position[]

type GapBridge = {
  from:  number[]
  to:    number[]
  color: [number, number, number, number]
}

function trailPath(t: Track): Position[] {
  return t.smoothedTrail.length >= 2
    ? posA(t.smoothedTrail)
    : t.trail.map(p => pos([p[0], p[1]]))
}

// 3-D path: aircraft trails climb to their recorded altitude (metres, stored in
// the raw trail tuple), vessel trails stay at sea level so coastal terrain
// occludes them. Falls back to a flat path when history is too sparse.
function trailPath3D(t: Track): Position[] {
  if (t.type === 'air' && t.trail.length >= 2) {
    return t.trail
      .filter(p => p[0] != null && p[1] != null)
      .map(p => pos([p[0], p[1], p[2] ?? 0]))
  }
  return t.smoothedTrail.length >= 2
    ? t.smoothedTrail.map(p => pos([p[0], p[1], 0]))
    : t.trail.map(p => pos([p[0], p[1], 0]))
}

// ─── buildTrailLayers ─────────────────────────────────────────────────────────
// Returns: [trailLayer, occludedTrailLayer, gapBridgeLayer, predictedPathLayer, selectedTrailLayer]
export function buildTrailLayers(
  tracks: Record<string, Track>,
  selectedUid: string | null,
  trailsVisible: boolean,
  threeD = false,
): Layer[] {
  const trackArr = Object.values(tracks)

  const hasTrail = (t: Track) => t.smoothedTrail.length >= 2 || t.trail.length >= 2

  // ── Non-selected history trails that draw on top (no terrain occlusion) ───
  // In 3-D mode, air/sea trails move to the depth-tested layer below.
  const trailLayer = new PathLayer<Track>({
    id:             'history-trails',
    data:           trailsVisible
      ? trackArr.filter(t =>
        t.type !== 'rail' && t.uid !== selectedUid && hasTrail(t)
        && !(threeD && (t.type === 'air' || t.type === 'sea')),
      )
      : [],
    getPath:        trailPath,
    getColor:       (t) => entityColor(t, 180),
    getWidth:       () => 2.5,
    widthMinPixels: 1.5,
    widthUnits:     'pixels',
    jointRounded:   true,
    capRounded:     true,
    pickable:       false,
  })

  // ── Air/sea history trails, depth-tested against terrain (3-D only) ───────
  const occludedTrailLayer = new PathLayer<Track>({
    id:             'history-trails-occluded',
    data:           trailsVisible && threeD
      ? trackArr.filter(t =>
        (t.type === 'air' || t.type === 'sea') && t.uid !== selectedUid && hasTrail(t),
      )
      : [],
    getPath:        trailPath3D,
    getColor:       (t) => entityColor(t, 180),
    getWidth:       () => 2.5,
    widthMinPixels: 1.5,
    widthUnits:     'pixels',
    jointRounded:   true,
    capRounded:     true,
    pickable:       false,
    parameters:     DEPTH_OCCLUDE,
    updateTriggers: { getPath: threeD },
  })

  // ── Gap bridge: connect smoothed trail end → live position ───────────────
  // Only bridged when the distance is small (Chaikin smoothing pulls the trail
  // end a few metres back from the true last point). Large distances mean
  // BEAST lost the aircraft between sessions — don't draw a cross-map line.
  const MAX_GAP_BRIDGE_M = 15_000  // 15 km — anything larger is a tracking gap
  const gapData: GapBridge[] = []
  if (trailsVisible) {
    for (const t of trackArr) {
      if (!t.smoothedTrail.length) continue
      const last = t.smoothedTrail[t.smoothedTrail.length - 1]
      const gapM = getDistanceMeters(last[0], last[1], t.lon, t.lat)
      if (gapM > 5 && gapM < MAX_GAP_BRIDGE_M) {
        gapData.push({
          from:  last,
          to:    [t.lon, t.lat],
          color: entityColor(t),
        })
      }
    }
  }

  const gapBridgeLayer = new LineLayer<GapBridge>({
    id:                'trail-gap-bridge',
    data:              gapData,
    getSourcePosition: (d) => pos(d.from),
    getTargetPosition: (d) => pos(d.to),
    getColor:          (d) => d.color,
    getWidth:          3.5,
    widthUnits:        'pixels',
    widthMinPixels:    1,
  })

  // ── Predicted path (dashed) ──────────────────────────────────────────────
  // PathStyleExtension injects getDashArray/dashJustified at runtime;
  // cast to any to satisfy PathLayerProps which doesn't declare them.
  const predictedPathLayer = new PathLayer<Track>({
    id:             'predicted-path',
    // Trains follow fixed tracks — straight-line prediction is misleading, so exclude them.
    data:           trackArr.filter(t => t.predictedPath.length > 1 && t.type !== 'rail'),
    getPath:        (t: Track) => [pos([t.lon, t.lat]), ...posA(t.predictedPath)],
    getColor:       (t: Track) => {
      const [r, g, b] = entityColor(t)
      return [r, g, b, 160] as [number, number, number, number]
    },
    getWidth:       2,
    widthUnits:     'pixels',
    widthMinPixels: 1,
    extensions:     [new PathStyleExtension({ dash: true })],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDashArray:   () => [6, 4] as any,
    dashJustified:  true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as PathLayer<Track>

  // ── Selected track trail (on top, brighter) ──────────────────────────────
  const sel = selectedUid ? tracks[selectedUid] : undefined
  const showSelectedTrail = trailsVisible || sel?.type === 'tak' || sel?.type === 'rail'
  const selectedTrailLayer = new PathLayer<Track>({
    id:             'selected-trail',
    data:           showSelectedTrail && sel && (sel.smoothedTrail.length >= 2 || sel.trail.length >= 2) ? [sel] : [],
    getPath:        trailPath,
    getColor:       (t) => entityColor(t, 255),
    getWidth:       () => 3.5,
    widthMinPixels: 2,
    widthUnits:     'pixels',
    jointRounded:   true,
    capRounded:     true,
  })

  return [trailLayer, occludedTrailLayer, gapBridgeLayer, predictedPathLayer, selectedTrailLayer]
}
