import { chaikinSmooth, filterTrailSpikes, destinationPoint } from './layers/geoUtils'
import type { Entity, Track, TrailPt } from './storeTypes'

export const ALT_FT_TO_M  = 0.3048
export const SPD_KT_TO_MS = 0.5144
export const TRAIL_CAP    = 150
const PRED_STEP_S  = 20
const PRED_STEPS   = 3

export function entityToTrack(entity: Entity, existing?: Track): Track | null {
  if (entity.lat == null || entity.lon == null) return null
  const isAir = entity.entity_type === 'aircraft'
  const isSea = entity.entity_type === 'vessel'
  const isAprs = entity.entity_type === 'aprs'
  const isFire = entity.entity_type === 'fire_incident'
  if (!isAir && !isSea && !isAprs && !isFire) return null

  const altMeters  = isAir ? (entity.altitude ?? 0) * ALT_FT_TO_M : 0
  const speedMs    = (entity.speed ?? 0) * SPD_KT_TO_MS
  const courseTrue = entity.heading ?? 0

  // ── Build raw trail ──────────────────────────────────────────────────────
  // Prefer the server-side position ring buffer (trail_pts) when available.
  // It is emitted by the BEAST decoder and contains every resolved CPR fix,
  // giving us a much denser history than the 1-pt/sec client accumulation.
  let trail: TrailPt[]

  if (entity.trail_pts && entity.trail_pts.length >= 2 && isAir) {
    // Convert server trail: [lat, lon, alt_ft, unix_ts] → TrailPt [lon, lat, altM, speedMs, ts]
    const serverTrail: TrailPt[] = entity.trail_pts.map(p => [
      p[1],                         // lon
      p[0],                         // lat
      p[2] * ALT_FT_TO_M,           // alt_ft → metres
      speedMs,                      // speed not stored per-point; use current
      new Date(p[3] * 1000).toISOString(), // unix_ts → ISO string
    ])

    // Trim to the most recent continuous tracking segment.
    // A gap > MAX_TRAIL_GAP_SEC between consecutive positions means BEAST lost
    // the aircraft and later reacquired it — older segments produce a ghost trail
    // detached from the current icon.
    const MAX_TRAIL_GAP_SEC = 60
    let segmentStart = 0
    for (let i = 1; i < entity.trail_pts.length; i++) {
      if (entity.trail_pts[i][3] - entity.trail_pts[i - 1][3] > MAX_TRAIL_GAP_SEC) {
        segmentStart = i
      }
    }
    const continuousTrail = serverTrail.slice(segmentStart)

    // Merge: adopt server trail when it is at least as dense as what we have.
    if (!existing?.trail || continuousTrail.length >= existing.trail.length) {
      trail = continuousTrail.slice(-TRAIL_CAP)
    } else {
      trail = existing.trail
    }
  } else {
    // Fallback: client-side accumulation (non-BEAST sources, or startup).
    const newPt: TrailPt = [entity.lon, entity.lat, altMeters, speedMs, entity.last_seen]
    trail = [...(existing?.trail ?? []), newPt].slice(-TRAIL_CAP)
  }

  const smoothedTrail = trail.length >= 2
    ? chaikinSmooth(filterTrailSpikes(trail.map(p => [p[0], p[1]])), 2)
    : []

  const predictedPath: [number, number][] = []
  if (speedMs >= 0.5 && !isFire) {
    for (let i = 1; i <= PRED_STEPS; i++) {
      predictedPath.push(destinationPoint(entity.lon, entity.lat, courseTrue, speedMs * PRED_STEP_S * i))
    }
  }

  return {
    uid:          entity.entity_id,
    lat:          entity.lat,
    lon:          entity.lon,
    altMeters,
    speedMs,
    courseTrue,
    type:         isAir ? 'air' : isSea ? 'sea' : isAprs ? 'ground' : 'hazard',
    callsign:     entity.display_name,
    category:     (entity.identity?.category as string | undefined) ?? entity.tags?.[0],
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
