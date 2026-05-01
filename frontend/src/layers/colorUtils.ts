import type { Track } from '../store'

export type RGBA = [number, number, number, number]

const ALTITUDE_STOPS: [number, [number, number, number]][] = [
  [0.00, [  0, 255, 100]],
  [0.10, [ 50, 255,  50]],
  [0.20, [150, 255,   0]],
  [0.30, [255, 255,   0]],
  [0.40, [255, 200,   0]],
  [0.52, [255, 150,   0]],
  [0.64, [255, 100,   0]],
  [0.76, [255,  50,  50]],
  [0.88, [255,   0, 100]],
  [1.00, [255,   0, 255]],
]

const SPEED_STOPS: [number, [number, number, number]][] = [
  [0.00, [  0,  60, 140]],
  [0.20, [  0,  90, 200]],
  [0.40, [  0, 150, 220]],
  [0.60, [  0, 200, 230]],
  [0.80, [  0, 230, 230]],
  [1.00, [100, 255, 255]],
]

const MAX_ALT      = 13_000
const MAX_SPEED_MS = 25 * 0.5144
const GAMMA        = 0.4

function interpolateStops(
  stops: [number, [number, number, number]][],
  t: number,
  alpha: number,
): RGBA {
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]
    if (t <= t1) {
      const [t0, c0] = stops[i - 1]
      const f = (t - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
        alpha,
      ]
    }
  }
  return [...stops[stops.length - 1][1], alpha] as RGBA
}

export function altitudeToColor(altMeters: number, alpha = 220): RGBA {
  const t = Math.pow(Math.max(0, Math.min(altMeters, MAX_ALT)) / MAX_ALT, GAMMA)
  return interpolateStops(ALTITUDE_STOPS, t, alpha)
}

export function speedToColor(speedMs: number, alpha = 220): RGBA {
  const t = Math.max(0, Math.min(speedMs, MAX_SPEED_MS)) / MAX_SPEED_MS
  return interpolateStops(SPEED_STOPS, t, alpha)
}

export function entityColor(track: Track, alpha?: number): RGBA {
  if (track.type === 'sea') return speedToColor(track.speedMs, alpha)
  if (track.type === 'ground') return [120, 240, 255, alpha ?? 220]
  if (track.type === 'hazard') return [255, 96, 64, alpha ?? 220]
  return altitudeToColor(track.altMeters, alpha)
}
