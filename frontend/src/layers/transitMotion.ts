import type { Track } from '../storeTypes'

// A short visual transition between two publisher positions. We never project
// past the newest report, and large jumps reset immediately.
const TRANSITION_MS = 2_000
const MAX_BUS_JUMP_M = 800
const MAX_TRAIN_JUMP_M = 1_500

export interface TransitMotionState {
  fromLon: number
  fromLat: number
  toLon: number
  toLat: number
  fromCourse: number
  toCourse: number
  startedAt: number
}

function distanceMeters(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (((bLon - aLon + 540) % 360) - 180) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function smoothTransitPosition(
  track: Track,
  previous: TransitMotionState | undefined,
  now: number,
): { lon: number; lat: number; courseTrue: number; state: TransitMotionState } {
  const target = { lon: track.lon, lat: track.lat, courseTrue: track.courseTrue }
  const settled = (): TransitMotionState => ({
    fromLon: target.lon, fromLat: target.lat, toLon: target.lon, toLat: target.lat, startedAt: now,
    fromCourse: target.courseTrue, toCourse: target.courseTrue,
  })
  if (!previous || track.positionStale) return { ...target, state: settled() }

  const elapsed = Math.max(0, now - previous.startedAt)
  const fraction = Math.min(1, elapsed / TRANSITION_MS)
  const shownLon = previous.fromLon + (previous.toLon - previous.fromLon) * fraction
  const shownLat = previous.fromLat + (previous.toLat - previous.fromLat) * fraction
  const courseDelta = ((previous.toCourse - previous.fromCourse + 540) % 360) - 180
  const shownCourse = (previous.fromCourse + courseDelta * fraction + 360) % 360
  if (target.lon === previous.toLon && target.lat === previous.toLat && target.courseTrue === previous.toCourse) {
    return { lon: shownLon, lat: shownLat, courseTrue: shownCourse, state: previous }
  }

  const jump = distanceMeters(previous.toLon, previous.toLat, target.lon, target.lat)
  if (jump > (track.type === 'bus' ? MAX_BUS_JUMP_M : MAX_TRAIN_JUMP_M)) {
    return { ...target, state: settled() }
  }
  const state = { fromLon: shownLon, fromLat: shownLat, toLon: target.lon, toLat: target.lat,
    fromCourse: shownCourse, toCourse: target.courseTrue, startedAt: now }
  return { lon: shownLon, lat: shownLat, courseTrue: shownCourse, state }
}
