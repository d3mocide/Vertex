import { destinationPoint } from './geoUtils'
import type { Track } from '../store'
import { isSupplementSource } from '../storeTypes'

// Baseline correction window; source switches and larger offsets ease longer.
const BLEND_WINDOW_MS = 2_000
const OPENSKY_MIN_BLEND_MS = 8_000
const OPENSKY_MAX_BLEND_MS = 25_000
// Hard ceiling on how far a stale anchor may be extrapolated. Without this, a
// large wall-clock gap (e.g. the rAF loop being paused while the tab is
// backgrounded) would project aircraft forward by minutes, making icons "drift
// away" and then snap back when the tab regains focus. The ceiling is above the
// widest blend window so it never clips normal motion, only pathological gaps.
const MAX_PROJECT_MS = 30_000
// Oldest fix time honoured when anchoring a report. Older fixes are flagged
// stale upstream and frozen instead of extrapolated.
const MAX_FIX_AGE_MS = 15_000

export interface PVBState {
  // Server anchor — position/velocity from the most recent server report.
  // sTime is when that position was measured (the fix), not when it arrived:
  // local feeds often deliver a fix several seconds old, and projecting it as
  // if it were current leaves the icon behind, then lurching to catch up.
  sLon: number; sLat: number; sSpeedMs: number; sCourse: number; sTime: number
  // When the report arrived — the blend from visual to server runs from here.
  rTime: number
  // Signature of the last applied server report. Includes source/position/freshness
  // so we still detect updates when trail timestamps are unchanged.
  lastReportKey: string
  source: string
  // Source-aware blend window (longer for sparse feeds like OpenSky)
  blendWindowMs: number
  correctionLon: number; correctionLat: number
  velocityLon: number; velocityLat: number
  shownCourse: number; shownHeading?: number
  renderedCourse?: number; renderedHeading?: number
  horizonMs: number
}

function reportKey(track: Track, lastTs: string): string {
  // Prefer trail timestamp when available: BEAST updates last_seen frequently
  // even without a new resolved position, which should not reset smoothing.
  const timeKey = track.type === 'sea' ? String(track.fixTimeMs ?? track.lastSeen ?? '') : lastTs || track.lastSeen || ''
  return [
    track.source,
    timeKey,
    track.lon.toFixed(5),
    track.lat.toFixed(5),
    track.speedMs.toFixed(2), track.courseTrue.toFixed(1),
    track.vesselHeading ?? '', track.vesselStationary ? 'stationary' : '',
    track.positionStale ? '1' : '0',
    track.positionDr ? '1' : '0',
  ].join('|')
}

function sourceBlendWindowMs(source: string, reportIntervalMs: number): number {
  const src = (source || '').toLowerCase()
  if (!isSupplementSource(src)) {
    // For local sources (BEAST/UltraFeeder), we want a tight blend.
    // Use 1.2x the observed interval, but cap it so it doesn't get too jittery or too laggy.
    const interval = reportIntervalMs > 0 ? reportIntervalMs : 1000
    return Math.max(400, Math.min(BLEND_WINDOW_MS, interval * 1.2))
  }
  const adaptive = Math.round(reportIntervalMs * 0.85)
  return Math.max(OPENSKY_MIN_BLEND_MS, Math.min(OPENSKY_MAX_BLEND_MS, adaptive))
}

function project(
  lon: number, lat: number,
  course: number, speedMs: number,
  elapsedMs: number, horizonMs = MAX_PROJECT_MS,
): [number, number] {
  if (speedMs < 0.5 || elapsedMs <= 0) return [lon, lat]
  let clamped = Math.min(elapsedMs, horizonMs)
  if (horizonMs === 45_000 && clamped > 35_000) {
    const tail = clamped - 35_000
    clamped = 35_000 + tail - tail * tail / 20_000
  }
  return destinationPoint(lon, lat, course, speedMs * clamped / 1_000)
}

/** When the track's position was measured, clamped to a sane window. */
function fixTime(track: Track, nowMs: number): number {
  const t = track.fixTimeMs
  if (t == null || !Number.isFinite(t)) return nowMs
  return Math.min(nowMs, Math.max(nowMs - (track.type === 'sea' ? 90_000 : MAX_FIX_AGE_MS), t))
}

function evaluatePVB(state: PVBState, nowMs: number): [number, number] {
  const [sLon, sLat] = project(state.sLon, state.sLat, state.sCourse, state.sSpeedMs,
    nowMs - state.sTime, state.horizonMs)
  const elapsed = Math.max(0, nowMs - state.rTime)
  const t = Math.min(elapsed / state.blendWindowMs, 1)
  const weight = 1 - t * t * (3 - 2 * t)
  const velocityWeight = elapsed * (1 - t) ** 2
  // Hermite correction matches both displayed position and velocity at arrival,
  // then converges to the moving report. Frequent reports do not restart speed.
  return [sLon + state.correctionLon * weight + state.velocityLon * velocityWeight,
    sLat + state.correctionLat * weight + state.velocityLat * velocityWeight]
}

// Called every animation frame for each track. nowMs must be wall-clock
// (Date.now()) so it is comparable with the track's fix time.
// Mutates pvb in-place and returns the PVB-blended [lon, lat].
export function applyPVB(
  pvb: Record<string, PVBState>,
  track: Track,
  nowMs: number,
): [number, number] {
  const lastTs = track.trail[track.trail.length - 1]?.[4] ?? ''
  const lastReportKey = reportKey(track, lastTs)
  // Stale positions freeze — except server-side dead-reckoned ones, whose
  // lat/lon are already advancing along the last known velocity. Keep
  // projecting those between reports so motion stays continuous instead of
  // stepping once per snapshot.
  const seaMotionUnavailable = track.type === 'sea' && (!track.vesselCourseKnown
    || track.vesselStationary || (track.fixTimeMs != null && nowMs - track.fixTimeMs >= 45_000))
  const frozen = Boolean((track.positionStale && !track.positionDr) || seaMotionUnavailable)
  const projectedSpeed = frozen ? 0 : track.speedMs
  const state  = pvb[track.uid]
  const horizonMs = track.type === 'sea' ? 45_000 : MAX_PROJECT_MS

  if (!state) {
    // First sighting: place the icon where the fix says it is now.
    const sTime = fixTime(track, nowMs)
    const [lon, lat] = project(track.lon, track.lat, track.courseTrue, projectedSpeed, nowMs - sTime, horizonMs)
    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: projectedSpeed, sCourse: track.courseTrue, sTime,
      rTime: nowMs,
      lastReportKey,
      source: track.source,
      blendWindowMs: sourceBlendWindowMs(track.source, BLEND_WINDOW_MS),
      correctionLon: 0, correctionLat: 0, velocityLon: 0, velocityLat: 0,
      shownCourse: track.courseTrue, shownHeading: track.vesselHeading, horizonMs,
    }
    return [lon, lat]
  }

  if (state.lastReportKey !== lastReportKey) {
    // A new server report arrived. Evaluate the old PVB at this instant to get
    // the position the icon was at, then use that as the new visual anchor so
    // the icon continues smoothly from where it was rather than jumping.
    const [vLon, vLat] = evaluatePVB(state, nowMs)
    const reportInterval = nowMs - state.rTime

    if (track.positionStale && !track.positionDr) {
      // The fix went stale without a dead-reckoned estimate. Hold the icon
      // where it is rather than pulling it back to the old fix; the next real
      // fix blends forward from here.
      pvb[track.uid] = {
        sLon: vLon, sLat: vLat, sSpeedMs: 0, sCourse: track.courseTrue, sTime: nowMs,
        rTime: nowMs,
        lastReportKey,
        source: track.source,
        blendWindowMs: state.blendWindowMs,
        correctionLon: 0, correctionLat: 0, velocityLon: 0, velocityLat: 0,
        shownCourse: state.renderedCourse ?? state.shownCourse, shownHeading: state.renderedHeading ?? state.shownHeading, horizonMs,
      }
      return [vLon, vLat]
    }

    const sTime = fixTime(track, nowMs)
    const target = project(track.lon, track.lat, track.courseTrue, projectedSpeed, nowMs - sTime, horizonMs)
    const targetNext = project(track.lon, track.lat, track.courseTrue, projectedSpeed, nowMs + 10 - sTime, horizonMs)
    const previous = evaluatePVB(state, nowMs - 10)
    const errorMeters = Math.hypot((vLon - target[0]) * Math.cos(vLat * Math.PI / 180), vLat - target[1]) * 111_320
    const baseWindow = sourceBlendWindowMs(track.source, reportInterval)
    const blendWindowMs = Math.min(25_000, Math.max(baseWindow,
      state.source !== track.source ? 6_000 : 0,
      errorMeters * 1500 / Math.max(track.type === 'sea' ? 2 : 15, projectedSpeed * 0.25)))
    // Large discontinuities are new anchors, rather than long invented journeys.
    const reset = errorMeters > Math.max(track.type === 'sea' ? 600 : 3000, projectedSpeed * 30)

    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: projectedSpeed, sCourse: track.courseTrue,
      sTime,
      rTime: nowMs,
      lastReportKey,
      source: track.source,
      blendWindowMs, horizonMs,
      correctionLon: reset ? 0 : vLon - target[0], correctionLat: reset ? 0 : vLat - target[1],
      velocityLon: reset ? 0 : (vLon - previous[0] - targetNext[0] + target[0]) / 10,
      velocityLat: reset ? 0 : (vLat - previous[1] - targetNext[1] + target[1]) / 10,
      shownCourse: state.renderedCourse ?? state.shownCourse, shownHeading: state.renderedHeading ?? state.shownHeading,
    }
  }

  return evaluatePVB(pvb[track.uid], nowMs)
}

/** Render orientation and prediction from the same moving anchor as the icon. */
export function applyPVBTrack(pvb: Record<string, PVBState>, track: Track, nowMs: number): Track {
  const [lon, lat] = applyPVB(pvb, track, nowMs)
  const state = pvb[track.uid]
  const t = Math.min(Math.max(0, nowMs - state.rTime) / (track.type === 'sea' ? 4000 : 2000), 1)
  const weight = t * t * (3 - 2 * t)
  const angle = (from: number, to: number) => (from + (((to - from + 540) % 360) - 180) * weight + 360) % 360
  const courseTrue = angle(state.shownCourse, track.courseTrue)
  const vesselHeading = track.vesselHeading == null ? undefined
    : angle(state.shownHeading ?? track.vesselHeading, track.vesselHeading)
  // Retain the orientation actually rendered when a subsequent report interrupts.
  state.renderedCourse = courseTrue
  state.renderedHeading = vesselHeading
  const ageMs = Math.max(0, nowMs - state.sTime)
  const remaining = Math.max(0, state.horizonMs - ageMs) / 1000
  const predictedPath: [number, number][] = []
  if (state.sSpeedMs >= 0.5 && !track.positionStale && !track.positionDr && remaining > 0) {
    const start = project(state.sLon, state.sLat, state.sCourse, state.sSpeedMs, ageMs, state.horizonMs)
    for (let i = 1; i <= 3; i++) {
      const end = project(state.sLon, state.sLat, state.sCourse, state.sSpeedMs,
        ageMs + remaining * 1000 * i / 3, state.horizonMs)
      predictedPath.push([lon + end[0] - start[0], lat + end[1] - start[1]])
    }
  }
  const positionStale = Boolean(track.positionStale || (!track.positionDr
    && track.fixTimeMs != null && nowMs - track.fixTimeMs >= state.horizonMs))
  return { ...track, lon, lat, courseTrue, vesselHeading, predictedPath, positionStale }
}
