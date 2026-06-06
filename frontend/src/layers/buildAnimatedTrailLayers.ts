import { Layer } from '@deck.gl/core'
import { TripsLayer } from '@deck.gl/geo-layers'
import type { Track } from '../store'
import { entityColor } from './colorUtils'

// ─── buildAnimatedTrailLayers ─────────────────────────────────────────────────
// A decorative "flow" pass (the Kpler aesthetic): a glowing comet head sweeps
// along each track's history while the static trail stays underneath. Drawn on
// top (no depth test) so the glow reads clearly over terrain. Default-off and
// gated by the Animated Trails toggle because it adds per-frame GPU work.

const TRAIL_LENGTH = 0.35   // fraction of the (normalised) path lit at once

// Shared point source so getPath and getTimestamps stay in lock-step.
// Aircraft climb to altitude in 3-D; everything else drapes at z=0.
function animPoints(t: Track, threeD: boolean): number[][] {
  if (threeD && t.type === 'air' && t.trail.length >= 2) {
    return t.trail
      .filter(p => p[0] != null && p[1] != null)
      .map(p => [p[0], p[1], p[2] ?? 0])
  }
  if (t.smoothedTrail.length >= 2) return t.smoothedTrail.map(p => [p[0], p[1], 0])
  return t.trail.filter(p => p[0] != null && p[1] != null).map(p => [p[0], p[1], 0])
}

// Normalised 0→1 timestamps, one per point, matching animPoints length.
function animTimestamps(t: Track, threeD: boolean): number[] {
  const n = animPoints(t, threeD).length
  if (n < 2) return []
  return Array.from({ length: n }, (_, i) => i / (n - 1))
}

export function buildAnimatedTrailLayers(
  tracks: Record<string, Track>,
  threeD: boolean,
  nowMs: number,
): Layer[] {
  const data = Object.values(tracks).filter(
    t => t.type !== 'rail' && animPoints(t, threeD).length >= 2,
  )

  // Loop the head across the path on a 4-second cycle; overshoot by TRAIL_LENGTH
  // so the comet fully exits before re-entering.
  const currentTime = ((nowMs / 4000) % 1) * (1 + TRAIL_LENGTH)

  const trips = new TripsLayer<Track>({
    id:             'animated-trails',
    data,
    getPath:        (t) => animPoints(t, threeD) as [number, number, number][],
    getTimestamps:  (t) => animTimestamps(t, threeD),
    getColor:       (t) => {
      const [r, g, b] = entityColor(t)
      return [r, g, b]
    },
    getWidth:       3,
    widthMinPixels: 2,
    widthUnits:     'pixels',
    capRounded:     true,
    jointRounded:   true,
    fadeTrail:      true,
    trailLength:    TRAIL_LENGTH,
    currentTime,
    opacity:        0.9,
    pickable:       false,
    updateTriggers: { getPath: threeD, getTimestamps: threeD },
  })

  return [trips]
}
