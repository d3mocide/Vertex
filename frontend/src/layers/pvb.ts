import { destinationPoint } from './geoUtils'
import type { Track } from '../store'

// Time over which the rendered position blends from the old visual projection
// to the new server projection. Should be less than the poller interval (5 s).
const BLEND_WINDOW_MS = 2_000

export interface PVBState {
  // Server anchor — position/velocity from the most recent server report
  sLon: number; sLat: number; sSpeedMs: number; sCourse: number; sTime: number
  // Visual anchor — the computed position at the moment the last update arrived
  vLon: number; vLat: number; vSpeedMs: number; vCourse: number; vTime: number
  // Timestamp of the last trail point, used to detect new server reports
  lastTs: string
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
  const t = Math.min((nowMs - state.sTime) / BLEND_WINDOW_MS, 1)
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
  const state  = pvb[track.uid]

  if (!state) {
    // First time we see this entity — start both anchors at the server position.
    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: track.speedMs, sCourse: track.courseTrue, sTime: nowMs,
      vLon: track.lon, vLat: track.lat, vSpeedMs: track.speedMs, vCourse: track.courseTrue, vTime: nowMs,
      lastTs,
    }
    return [track.lon, track.lat]
  }

  if (state.lastTs !== lastTs) {
    // A new server report arrived. Evaluate the old PVB at this instant to get
    // the position the icon was at, then use that as the new visual anchor so
    // the icon continues smoothly from where it was rather than jumping.
    const [vLon, vLat] = evaluatePVB(state, nowMs)
    // Visual anchor inherits new server velocity so both projections travel in the same
    // direction during the blend window — blend only corrects position offset, not heading.
    pvb[track.uid] = {
      sLon: track.lon, sLat: track.lat, sSpeedMs: track.speedMs, sCourse: track.courseTrue, sTime: nowMs,
      vLon, vLat, vSpeedMs: track.speedMs, vCourse: track.courseTrue, vTime: nowMs,
      lastTs,
    }
  }

  return evaluatePVB(pvb[track.uid], nowMs)
}
