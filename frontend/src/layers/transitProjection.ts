import type { Track } from '../storeTypes'

const MAX_AGE_MS = 25_000
const SLOWDOWN_MS = 5_000
const MIN_CORRECTION_MS = 6_000

interface MetricPath {
  points: [number, number][]
  distances: number[]
  metersLon: number
}

export interface TransitProjectionState {
  report: string
  startedAt: number
  correctionMs: number
  path: MetricPath
  distanceOffset: number
  crossLon: number
  crossLat: number
  headingOffset: number
  distance: number
  shownLon: number
  shownLat: number
  shownCourse: number
}

type DisplayPosition = { lon: number; lat: number; courseTrue: number }

function metricPath(points: [number, number][], lat: number): MetricPath {
  const metersLon = 111_320 * Math.max(0.2, Math.abs(Math.cos(lat * Math.PI / 180)))
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + Math.hypot(
      (points[i][0] - points[i - 1][0]) * metersLon,
      (points[i][1] - points[i - 1][1]) * 110_540))
  }
  return { points, distances, metersLon }
}

function pointAt(path: MetricPath, distance: number): [number, number] {
  for (let i = 1; i < path.points.length; i++) {
    if (distance <= path.distances[i]) {
      const length = path.distances[i] - path.distances[i - 1]
      const fraction = length > 0 ? Math.max(0, (distance - path.distances[i - 1]) / length) : 0
      const a = path.points[i - 1], b = path.points[i]
      return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
    }
  }
  return path.points[path.points.length - 1]
}

function closestPoint(path: MetricPath, lon: number, lat: number) {
  let best = { distance: 0, offset: Infinity, point: path.points[0] }
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i]
    const dx = (b[0] - a[0]) * path.metersLon, dy = (b[1] - a[1]) * 110_540
    const lengthSq = dx * dx + dy * dy
    if (lengthSq < 0.01) continue
    const fraction = Math.max(0, Math.min(1,
      ((lon - a[0]) * path.metersLon * dx + (lat - a[1]) * 110_540 * dy) / lengthSq))
    const point: [number, number] = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction]
    const offset = Math.hypot((point[0] - lon) * path.metersLon, (point[1] - lat) * 110_540)
    if (offset < best.offset) best = { offset, point,
      distance: path.distances[i - 1] + (path.distances[i] - path.distances[i - 1]) * fraction }
  }
  return best
}

function headingAt(path: MetricPath, distance: number, speed: number, fallback: number): number {
  const reach = Math.max(2, Math.min(8, speed * 0.4))
  const a = pointAt(path, Math.max(0, distance - reach))
  const b = pointAt(path, distance + reach)
  const dx = (b[0] - a[0]) * path.metersLon, dy = (b[1] - a[1]) * 110_540
  return Math.hypot(dx, dy) > 0.1 ? (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 : fallback
}

export function projectTransit(
  track: Track, nowMs: number, previous?: TransitProjectionState, initial?: DisplayPosition,
): { track: Track; state: TransitProjectionState } | null {
  const points = track.transitMotionPath
  if (!points || points.length < 2 || !track.fixTimeMs || track.positionStale || track.speedMs < 1) return null
  const ageMs = Math.max(0, nowMs - track.fixTimeMs)
  if (!Number.isFinite(ageMs)) return null
  // Slow to a stop over the last five seconds of the bounded prediction window.
  const elapsed = Math.min(MAX_AGE_MS, ageMs)
  const tail = Math.max(0, elapsed - (MAX_AGE_MS - SLOWDOWN_MS))
  const targetDistance = (elapsed - tail * tail / (2 * SLOWDOWN_MS)) * track.speedMs / 1_000
  const end = points[points.length - 1]
  const report = [track.lastSeen, track.lon, track.lat, track.speedMs, points.length,
    points[0][0], points[0][1], end[0], end[1]].join('|')
  let state = previous
  if (!state || state.report !== report) {
    const path = metricPath(points, track.lat)
    const target = pointAt(path, targetDistance)
    const origin = previous ? { lon: previous.shownLon, lat: previous.shownLat, courseTrue: previous.shownCourse }
      : initial ?? track
    const jump = Math.hypot((origin.lon - target[0]) * path.metersLon, (origin.lat - target[1]) * 110_540)
    const correct = jump < (track.type === 'bus' ? 800 : 1_500)
    const closest = closestPoint(path, origin.lon, origin.lat)
    const distanceOffset = correct ? closest.distance - targetDistance : 0
    const distance = correct ? closest.distance : targetDistance
    const course = headingAt(path, distance, track.speedMs, track.courseTrue)
    state = { report, startedAt: nowMs, path, distance,
      correctionMs: Math.max(MIN_CORRECTION_MS, Math.min(15_000,
        Math.abs(distanceOffset) * 3_000 / track.speedMs)), distanceOffset,
      crossLon: correct ? origin.lon - closest.point[0] : 0,
      crossLat: correct ? origin.lat - closest.point[1] : 0,
      headingOffset: correct ? ((origin.courseTrue - course + 540) % 360) - 180 : 0,
      shownLon: target[0], shownLat: target[1], shownCourse: course }
  }
  // Correct the distance along a moving path, rather than restarting movement
  // from a fixed point on every report. Smoothstep keeps correction velocity
  // continuous at the beginning and end of the handoff.
  const fraction = Math.min(1, Math.max(0, (nowMs - state.startedAt) / state.correctionMs))
  const weight = 1 - fraction * fraction * (3 - 2 * fraction)
  const distance = Math.min(state.path.distances[state.path.distances.length - 1],
    Math.max(state.distance, targetDistance + state.distanceOffset * weight))
  const point = pointAt(state.path, distance)
  const course = headingAt(state.path, distance, track.speedMs, state.shownCourse)
  state.distance = distance
  state.shownLon = point[0] + state.crossLon * weight
  state.shownLat = point[1] + state.crossLat * weight
  state.shownCourse = (course + state.headingOffset * weight + 360) % 360
  return { track: { ...track, lon: state.shownLon, lat: state.shownLat, courseTrue: state.shownCourse,
    positionDr: ageMs > 500 }, state }
}
