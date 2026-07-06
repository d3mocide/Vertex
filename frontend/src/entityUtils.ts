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
  const isTrain = entity.entity_type === 'train'
  const isSensor = entity.entity_type === 'rf_sensor'
  if (!isAir && !isSea && !isAprs && !isFire && !isTak && !isTrain && !isSensor) return null

  const altMeters  = isAir ? (entity.altitude ?? 0) * ALT_FT_TO_M : 0
  const speedMs    = (entity.speed ?? 0) * SPD_KT_TO_MS
  const courseTrue = entity.heading ?? 0
  const positionStale = Boolean(entity.position_stale)
  const positionDr = Boolean(entity.position_dr)

  // ── Build raw trail ──────────────────────────────────────────────────────
  // Trail sources (merged in order, oldest → newest):
  //   1. DB historical trail (historicalTrailCache) — fetched once on first
  //      appearance via useTrailHydration; covers hours of flight history.
  //   2. BEAST ring buffer (entity.trail_pts) — last ~2.5 min at 1 Hz.
  // This mirrors how FlightJar (tar1090) serves disk trace files + live feed.
  let trail: TrailPt[]

  if (isAir && entity.trail_pts && entity.trail_pts.length >= 1) {
    // Convert WS ring buffer: [lat, lon, alt_ft, unix_ts] → TrailPt
    const wsTrail: TrailPt[] = entity.trail_pts.map(p => [
      p[1],                         // lon
      p[0],                         // lat
      p[2] * ALT_FT_TO_M,           // alt_ft → metres
      speedMs,                      // speed not stored per-point; use current
      new Date(p[3] * 1000).toISOString(),
    ])

    // Prepend DB historical trail.  Only include cached points that are older
    // than the start of the WS ring buffer to avoid duplicates.
    const wsTsFirstMs = entity.trail_pts[0][3] * 1000 // unix ms
    const cached = historicalTrailCache.get(entity.entity_id) ?? []
    const olderCached = cached.filter(p => {
      const ts = p[4] ? new Date(p[4]).getTime() : 0
      return ts < wsTsFirstMs - 5_000  // 5-second overlap buffer
    })

    const merged = [...olderCached, ...wsTrail]

    // Trim to the most recent continuous flight segment.
    // Use 5-minute gap threshold so brief reception holes don't break history.
    const MAX_TRAIL_GAP_MS = 10 * 60 * 1000
    let segmentStart = 0
    for (let i = 1; i < merged.length; i++) {
      const tA = merged[i - 1][4] ? new Date(merged[i - 1][4]!).getTime() : 0
      const tB = merged[i][4] ? new Date(merged[i][4]!).getTime() : 0
      if (tB - tA > MAX_TRAIL_GAP_MS) segmentStart = i
    }

    const continuousTrail = merged.slice(segmentStart)

    // Prefer merged trail when it's richer than what we already have rendered.
    if (!existing?.trail || continuousTrail.length >= existing.trail.length) {
      trail = continuousTrail.slice(-DB_TRAIL_CAP)
    } else {
      trail = existing.trail
    }
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

  const predictedPath: [number, number][] = []
  if (speedMs >= 0.5 && !isFire && !positionStale) {
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
    lat:          entity.lat,
    lon:          entity.lon,
    altMeters,
    speedMs,
    courseTrue,
    type:         isAir ? 'air' : isSea ? 'sea' : isTak ? 'tak' : isAprs ? 'ground' : isTrain ? 'rail' : isSensor ? 'sensor' : 'hazard',
    callsign:     entity.display_name,
    category:     (entity.identity?.category as string | undefined) ?? entity.tags?.[0],
    stationType:  isAprs ? (entity.identity?.station_type as string | undefined) : undefined,
    trail,
    smoothedTrail,
    predictedPath,
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
