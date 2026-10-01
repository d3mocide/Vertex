import type { Track } from '../storeTypes'

const MAX_AGE_MS = 25_000
const CORRECTION_MS = 2_000

export interface TransitProjectionState {
  report: string
  startedAt: number
  fromLon: number
  fromLat: number
  fromCourse: number
  shownLon: number
  shownLat: number
  shownCourse: number
}

export function projectTransit(
  track: Track, nowMs: number, previous?: TransitProjectionState,
): { track: Track; state: TransitProjectionState } | null {
  const path = track.transitMotionPath
  if (!path || path.length < 2 || !track.fixTimeMs || track.positionStale || track.speedMs < 1) return null
  const ageMs = Math.max(0, nowMs - track.fixTimeMs)
  if (!Number.isFinite(ageMs)) return null
  let remaining = Math.min(MAX_AGE_MS, ageMs) * track.speedMs / 1_000
  const metersLon = 111_320 * Math.max(0.2, Math.abs(Math.cos(track.lat * Math.PI / 180)))
  const metersLat = 110_540
  let lon = path[0][0], lat = path[0][1], course = track.courseTrue
  for (let i = 1; i < path.length; i++) {
    const next = path[i]
    const dx = (next[0] - lon) * metersLon
    const dy = (next[1] - lat) * metersLat
    const length = Math.hypot(dx, dy)
    if (length < 0.1) continue
    course = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360
    if (remaining <= length) {
      const fraction = remaining / length
      lon += (next[0] - lon) * fraction
      lat += (next[1] - lat) * fraction
      break
    }
    remaining -= length
    lon = next[0]; lat = next[1]
  }
  const report = [track.lastSeen, track.lon, track.lat, path[0][0], path[0][1]].join('|')
  let state = previous
  if (!state || state.report !== report) {
    const jump = state ? Math.hypot((state.shownLon-lon)*metersLon, (state.shownLat-lat)*metersLat) : Infinity
    const correct = jump < (track.type === 'bus' ? 800 : 1_500)
    state = { report, startedAt: nowMs, fromLon: correct ? previous!.shownLon : state ? lon : track.lon,
      fromLat: correct ? previous!.shownLat : state ? lat : track.lat,
      fromCourse: correct ? previous!.shownCourse : state ? course : track.courseTrue,
      shownLon: lon, shownLat: lat, shownCourse: course }
  }
  const blend = Math.min(1, Math.max(0, (nowMs-state.startedAt)/CORRECTION_MS))
  const headingDelta = ((course-state.fromCourse+540)%360)-180
  const shownLon = state.fromLon + (lon-state.fromLon)*blend
  const shownLat = state.fromLat + (lat-state.fromLat)*blend
  const shownCourse = (state.fromCourse+headingDelta*blend+360)%360
  state.shownLon = shownLon; state.shownLat = shownLat; state.shownCourse = shownCourse
  return { track: { ...track, lon: shownLon, lat: shownLat, courseTrue: shownCourse,
    positionDr: ageMs > 500 }, state }
}
