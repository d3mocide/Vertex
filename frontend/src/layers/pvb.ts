import { destinationPoint } from './geoUtils'
import type { Track } from '../store'

// Time over which the rendered position blends from the old visual projection
// to the new server projection. Should be less than the poller interval (5 s).
const BLEND_WINDOW_MS = 2_000
const OPENSKY_MIN_BLEND_MS = 8_000
const OPENSKY_MAX_BLEND_MS = 25_000

export interface PVBState {
  // Server anchor — position/velocity from the most recent server report
  sLon: number; sLat: number; sSpeedMs: number; sCourse: number; sTime: number
  // Visual anchor — the computed position at the moment the last update arrived
  vLon: number; vLat: number; vSpeedMs: number; vCourse: number; vTime: number
  // Signature of the last applied server report. Includes source/position/freshness
  // so we still detect updates when trail timestamps are unchanged.
  lastReportKey: string
  source: string
  // Source-aware blend window (longer for sparse feeds like OpenSky)
  blendWindowMs: number
}

function reportKey(track: Track, lastTs: string): string {
  // Prefer trail timestamp when available: BEAST updates last_seen frequently
  // even without a new resolved position, which should not reset smoothing.
  const timeKey = lastTs || track.lastSeen || ''
  return [
    track.source,
    timeKey,
    track.lon.toFixed(5),
    track.lat.toFixed(5),
    track.positionStale ? '1' : '0',
  ].join('|')
}

function sourceBlendWindowMs(source: string, reportIntervalMs: number): number {
  const src = (source || '').toLowerCase()
  if (src !== 'opensky') {
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
  elapsedMs: number,
): [number, number] {
  if (speedMs < 0.5 || elapsedMs <= 0) return [lon, lat]
  return destinationPoint(lon, lat, course, speedMs * elapsedMs / 1_000)
}

function evaluatePVB(state: PVBState, nowMs: number): [number, number] {
  const [sLon, sLat] = project(state.sLon, state.sLat, state.sCourse, state.sSpeedMs, nowMs - state.sTime)
  const [vLon, vLat] = project(state.vLon, state.vLat, state.vCourse, state.vSpeedMs, nowMs - state.vTime)
  // Smoothstep so the correction eases in and out rather than rubber-banding linearly.
  const t = Math.min((nowMs - state.sTime) / state.blendWindowMs, 1)
  const alpha = t * t * (3 - 2 * t)
  return [vLon + alpha * (sLon - vLon), vLat + alpha * (sLat - vLat)]
}

// Called every animation frame for each track.
// Mutates pvb in-place and returns the PVB-blended [lon, lat].
export function applyPVB(
  pvb: Record<string, PVBState>,
  track: Track,
  nowMs: number,
): [number, number] {
  const lastTs = track.trail[track.trail.length - 1]?.[4] ?? ''
  const lastReportKey = reportKey(track, lastTs)
  const projectedSpeed = track.positionStale ? 0 : track.speedMs
  const state  = pvb[track.uid]

  if (!state) {
    // First time we see this entity — start both anchors at the server position.
    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: projectedSpeed, sCourse: track.courseTrue, sTime: nowMs,
      vLon: track.lon, vLat: track.lat, vSpeedMs: projectedSpeed, vCourse: track.courseTrue, vTime: nowMs,
      lastReportKey,
      source: track.source,
      blendWindowMs: sourceBlendWindowMs(track.source, BLEND_WINDOW_MS),
    }
    return [track.lon, track.lat]
  }

  if (state.lastReportKey !== lastReportKey) {
    // When source changes (local <-> supplement), re-anchor immediately to avoid
    // blending between potentially disjoint track histories.
    if (state.source !== track.source) {
      pvb[track.uid] = {
        sLon: track.lon, sLat: track.lat, sSpeedMs: projectedSpeed, sCourse: track.courseTrue, sTime: nowMs,
        vLon: track.lon, vLat: track.lat, vSpeedMs: projectedSpeed, vCourse: track.courseTrue, vTime: nowMs,
        lastReportKey,
        source: track.source,
        blendWindowMs: sourceBlendWindowMs(track.source, BLEND_WINDOW_MS),
      }
      return [track.lon, track.lat]
    }

    // A new server report arrived. Evaluate the old PVB at this instant to get
    // the position the icon was at, then use that as the new visual anchor so
    // the icon continues smoothly from where it was rather than jumping.
    const [vLon, vLat] = evaluatePVB(state, nowMs)
    const reportInterval = nowMs - state.sTime

    // Visual anchor inherits new server velocity so both projections travel in the same
    // direction during the blend window — blend only corrects position offset, not heading.
    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: projectedSpeed, sCourse: track.courseTrue, sTime: nowMs,
      vLon, vLat, vSpeedMs: projectedSpeed, vCourse: track.courseTrue, vTime: nowMs,
      lastReportKey,
      source: track.source,
      blendWindowMs: sourceBlendWindowMs(track.source, reportInterval),
    }
  }

  return evaluatePVB(pvb[track.uid], nowMs)
}
