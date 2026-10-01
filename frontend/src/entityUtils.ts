import { chaikinSmooth, filterTrailSpikes, destinationPoint } from './layers/geoUtils'
import type { Entity, Track, TrailPt } from './storeTypes'

export const ALT_FT_TO_M  = 0.3048
export const SPD_KT_TO_MS = 0.5144
export const TRAIL_CAP    = 250
// DB-backed trails can hold much more history; cap the visible trail at this many points.
export const DB_TRAIL_CAP = 600
const PRED_STEP_S  = 20
const PRED_STEPS   = 3

// ── Historical trail cache ────────────────────────────────────────────────────
// Populated by useTrailHydration. Keyed by entity_id. Each entry holds the
// DB observation trail (older points not yet in the BEAST ring buffer).
export const historicalTrailCache = new Map<string, TrailPt[]>()

export function entityToTrack(entity: Entity, existing?: Track): Track | null {
  if (entity.lat == null || entity.lon == null) return null
  const isAir = entity.entity_type === 'aircraft'
  const isSea = entity.entity_type === 'vessel'
  const isAprs = entity.entity_type === 'aprs'
  const isFire = entity.entity_type === 'fire_incident'
  const isTak = entity.entity_type === 'tak_client'
  const isBus = entity.entity_type === 'bus'
  const isTrain = entity.entity_type === 'train'
  const isSensor = entity.entity_type === 'rf_sensor'
  if (!isAir && !isSea && !isAprs && !isFire && !isTak && !isTrain && !isBus && !isSensor) return null

  const altMeters  = isAir ? (entity.altitude ?? 0) * ALT_FT_TO_M : 0
  const speedMs    = (entity.speed ?? 0) * SPD_KT_TO_MS
  const courseTrue = entity.heading ?? 0
  const positionStale = Boolean(entity.position_stale)
  const positionDr = Boolean(entity.position_dr)

  // When the position was measured, on the local clock. Derived from the fix
  // age rather than the server's absolute timestamp so client/server clock skew
  // doesn't matter. A re-sent fix keeps its original time; a dead-reckoned
  // position is projected to the moment it was sent, so its age is ~0.
  let fixTimeMs: number | undefined
  if (existing?.fixTimeMs != null && existing.lat === entity.lat && existing.lon === entity.lon) {
    fixTimeMs = existing.fixTimeMs
  } else if (positionDr) {
    fixTimeMs = Date.now()
  } else if (typeof entity.position_age_s === 'number') {
    fixTimeMs = Date.now() - entity.position_age_s * 1000
  }

  // ── Build raw trail ──────────────────────────────────────────────────────
  // Trail sources (merged in order, oldest → newest):
  //   1. DB historical trail (historicalTrailCache) — fetched once on first
  //      appearance via useTrailHydration; covers hours of flight history.
  //   2. BEAST ring buffer (entity.trail_pts) — last ~2.5 min at 1 Hz.
  // This mirrors how FlightJar (tar1090) serves disk trace files + live feed.
  let trail: TrailPt[]

  if (isAir && entity.trail_pts && entity.trail_pts.length >= 1) {
    // Extend the trail already rendered with only the ring-buffer fixes newer
    // than its last point. Rebuilding from "DB history + ring buffer" each
    // time dropped every fix that had scrolled out of the ~150-point ring
    // since hydration, so the path cut a straight chord across that gap.
    const tsMs = (p: TrailPt) => (p[4] ? Date.parse(p[4]) : 0)
    const base = existing?.trail ?? []
    const baseLastMs = base.length ? tsMs(base[base.length - 1]) : -Infinity
    // WS ring buffer: [lat, lon, alt_ft, unix_ts] → TrailPt, new fixes only
    const fresh: TrailPt[] = entity.trail_pts
      .filter(p => p[3] * 1000 > baseLastMs)
      .map(p => [
        p[1],                         // lon
        p[0],                         // lat
        p[2] * ALT_FT_TO_M,           // alt_ft → metres
        speedMs,                      // speed not stored per-point; use current
        new Date(p[3] * 1000).toISOString(),
      ])
    const live = fresh.length ? [...base, ...fresh] : base

    // Prepend DB history (useTrailHydration) older than anything live, with a
    // 5-second overlap buffer to avoid duplicates.
    const liveFirstMs = live.length ? tsMs(live[0]) : Infinity
    const cached = historicalTrailCache.get(entity.entity_id) ?? []
    const olderCached = cached.filter(p => tsMs(p) < liveFirstMs - 5_000)
    const merged = olderCached.length ? [...olderCached, ...live] : live

    // Trim to the most recent continuous flight segment: a 10-minute gap
    // means a separate flight or a long reception hole.
    const MAX_TRAIL_GAP_MS = 10 * 60 * 1000
    let segmentStart = 0
    for (let i = 1; i < merged.length; i++) {
      if (tsMs(merged[i]) - tsMs(merged[i - 1]) > MAX_TRAIL_GAP_MS) segmentStart = i
    }

    trail = merged.slice(segmentStart).slice(-DB_TRAIL_CAP)
  } else if (isAir && entity.trail_pts && entity.trail_pts.length === 0) {
    // BEAST connected but no position fixes yet — keep existing trail if any.
    trail = existing?.trail ?? []
  } else {
    // Fallback: client-side accumulation (non-BEAST sources, or startup).
    const newPt: TrailPt = [entity.lon, entity.lat, altMeters, speedMs, entity.last_seen]
    trail = [...(existing?.trail ?? []), newPt].slice(-TRAIL_CAP)
  }

  const smoothedTrail = trail.length >= 2
    ? chaikinSmooth(filterTrailSpikes(trail.map(p => [p[0], p[1]])), 2)
    : []

  const transitMotionPath = (isBus || isTrain) && entity.source.startsWith('gtfs_')
    && Array.isArray(entity.identity?.motion_path)
    ? (entity.identity.motion_path as unknown[]).filter((p): p is [number, number] =>
        Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v)))
    : []
  const predictedPath: [number, number][] = []
  if (speedMs >= 0.5 && !isFire && !positionStale && !((isBus || isTrain) && entity.source.startsWith('gtfs_'))) {
    for (let i = 1; i <= PRED_STEPS; i++) {
      predictedPath.push(destinationPoint(entity.lon, entity.lat, courseTrue, speedMs * PRED_STEP_S * i))
    }
  }

  return {
    uid:          entity.entity_id,
    source:       entity.source,
    lastSeen:     entity.last_seen,
    positionStale,
    positionDr,
    fixTimeMs,
    lat:          entity.lat,
    lon:          entity.lon,
    altMeters,
    speedMs,
    courseTrue,
    type:         isAir ? 'air' : isSea ? 'sea' : isTak ? 'tak' : isAprs ? 'ground' : isTrain ? 'rail' : isBus ? 'bus' : isSensor ? 'sensor' : 'hazard',
    callsign:     entity.display_name,
    category:     (entity.identity?.category as string | undefined) ?? entity.tags?.[0],
    role:         isAir ? (entity.identity?.role as string | undefined) : undefined,
    alert:        isAir ? (entity.identity?.alert as string | undefined) : undefined,
    stationType:  isAprs ? (entity.identity?.station_type as string | undefined) : undefined,
    trail,
    smoothedTrail,
    predictedPath,
    transitMotionPath: transitMotionPath.length >= 2 && transitMotionPath.length <= 48 ? transitMotionPath : undefined,
    transitDestination: (isBus || isTrain) && entity.source.startsWith('gtfs_')
      && typeof entity.identity?.destination === 'string' ? entity.identity.destination : undefined,
    transitSpeedInferred: (isBus || isTrain) && entity.source.startsWith('gtfs_')
      && entity.identity?.speed_inferred === true,
  }
}

export function mergeEntityState(previous: Entity | undefined, incoming: Entity): Entity {
  if (!previous) return incoming
  if (incoming.entity_type !== 'aircraft') return incoming

  return {
    ...previous,
    ...incoming,
    // Keep cached enrichment keys between BEAST frame updates.
    identity: {
      ...(previous.identity ?? {}),
      ...(incoming.identity ?? {}),
    },
    tags: incoming.tags ?? previous.tags,
    distance_km: incoming.distance_km ?? previous.distance_km,
  }
}

export function loadFavoriteCamIds(): string[] {
  try { return JSON.parse(localStorage.getItem('favoriteCamIds') ?? '[]') }
  catch { return [] }
}
