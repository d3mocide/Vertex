import { Layer, type Position } from '@deck.gl/core'
import { PathLayer, LineLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Track } from '../store'
import { getDistanceMeters } from './geoUtils'
import { entityColor } from './colorUtils'

// deck.gl's Position is a @math.gl Vector (Float64Array-based), so plain number[]
// needs a double-cast when passing to typed accessors.
const pos  = (arr: number[]): Position   => arr as unknown as Position
const posA = (arr: number[][]): Position[] => arr as unknown as Position[]

function depthParams(globeMode: boolean, bias: number) {
  return globeMode
    ? { depthTest: true,  depthBias: bias }
    : { depthTest: false, depthBias: 0 }
}

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

// ─── buildTrailLayers ─────────────────────────────────────────────────────────
// Returns: [trailLayer, gapBridgeLayer, predictedPathLayer, selectedTrailLayer]
export function buildTrailLayers(
  tracks: Record<string, Track>,
  selectedUid: string | null,
  globeMode: boolean,
): Layer[] {
  const trackArr = Object.values(tracks)

  // ── All non-selected history trails ─────────────────────────────────────
  const trailLayer = new PathLayer<Track>({
    id:             'history-trails',
    data:           trackArr.filter(t =>
      t.uid !== selectedUid && (t.smoothedTrail.length >= 2 || t.trail.length >= 2),
    ),
    getPath:        trailPath,
    getColor:       (t) => entityColor(t, 180),
    getWidth:       () => 2.5,
    widthMinPixels: 1.5,
    widthUnits:     'pixels',
    jointRounded:   true,
    capRounded:     true,
    pickable:       false,
    parameters:     depthParams(globeMode, -50),
  })

  // ── Gap bridge: connect smoothed trail end → live position ───────────────
  const gapData: GapBridge[] = []
  for (const t of trackArr) {
    if (!t.smoothedTrail.length) continue
    const last = t.smoothedTrail[t.smoothedTrail.length - 1]
    if (getDistanceMeters(last[0], last[1], t.lon, t.lat) > 5) {
      gapData.push({
        from:  last,
        to:    [t.lon, t.lat, t.altMeters],
        color: entityColor(t),
      })
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
    data:           trackArr.filter(t => t.predictedPath.length > 1),
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
  const selectedTrailLayer = new PathLayer<Track>({
    id:             'selected-trail',
    data:           sel && (sel.smoothedTrail.length >= 2 || sel.trail.length >= 2) ? [sel] : [],
    getPath:        trailPath,
    getColor:       (t) => entityColor(t, 255),
    getWidth:       () => 3.5,
    widthMinPixels: 2,
    widthUnits:     'pixels',
    jointRounded:   true,
    capRounded:     true,
    parameters:     depthParams(globeMode, -50),
  })

  return [trailLayer, gapBridgeLayer, predictedPathLayer, selectedTrailLayer]
}
