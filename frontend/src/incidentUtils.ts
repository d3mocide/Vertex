import { getDistanceMeters } from './layers/geoUtils'
import { DEFAULT_CENTER } from './config'
import type { TrafficIncident } from './storeTypes'

/**
 * Checks if an incident is within a specific kilometer radius.
 */
export function isIncidentInRadius(inc: TrafficIncident, radiusKm: number): boolean {
  if (inc.lat == null || inc.lon == null) return false
  const dist = getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], inc.lon, inc.lat)
  return dist <= radiusKm * 1000
}

/**
 * Determines if a traffic incident is "major" based on keywords, distance, and severity.
 */
export function isMajorTrafficIncident(inc: TrafficIncident): boolean {
  const title = (inc.title || '').toLowerCase()
  const text = (title + ' ' + (inc.description || '')).toLowerCase()
  // ODOT's own impact rating ("Closure", "Estimated delay of 20 minutes - 2 hours",
  // "No to Minimum Delay", "Informational Only", "Unconfirmed"…).
  const impact = (inc.severity ?? '').toLowerCase()

  // 1. Distance gating (15km radius)
  if (inc.lat != null && inc.lon != null) {
    const dist = getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], inc.lon, inc.lat)
    if (dist > 15000) return false
  }

  // 2. Actual incidents are significant whatever the impact rating.
  const incidentKeywords = ['crash', 'collision', 'stalled', 'blocked', 'hazard', 'fire', 'injury', 'fatal', 'debris', 'emergency']
  if (incidentKeywords.some((kw) => title.includes(kw))) return true

  // 3. Otherwise trust ODOT's rating. Keyword matching on the description
  //    promoted routine roadwork ("…with lane closures…") and even items ODOT
  //    itself rated "Informational Only".
  if (/informational|no to minimum|no impact/.test(impact) || /no (traffic )?impacts/.test(text)) return false
  return /closure|detour|20 minutes - 2 hours|over 2 hours|2\+ hours|major|severe/.test(impact)
}

// ─── Infrastructure page triage ──────────────────────────────────────────────

export type IncidentClass = 'closure' | 'delay' | 'low'

const EVENT_WORDS = ['crash', 'collision', 'stalled', 'blocked', 'hazard', 'injury', 'fatal', 'debris']

/** ODOT's own impact rating, boiled down to what a driver needs: closed, slowed, or just a notice. */
export function classifyIncident(inc: TrafficIncident): IncidentClass {
  const impact = (inc.severity ?? '').toLowerCase()
  if (/closure|detour/.test(impact)) return 'closure'
  if (/estimated delay|20 minutes|over 2 hours|2\+ hours|major|severe/.test(impact)) return 'delay'
  const title = (inc.title ?? '').toLowerCase()
  if (EVENT_WORDS.some((w) => title.includes(w))) return 'delay'
  return 'low'
}

export function incidentAgeDays(inc: TrafficIncident, now = Date.now()): number | null {
  const t = inc.pubDate ? Date.parse(inc.pubDate) : NaN
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 86_400_000)
}

/** Human age: "2 h", "3 d". */
export function formatIncidentAge(days: number | null): string {
  if (days == null) return ''
  if (days < 1 / 24) return 'just now'
  if (days < 1) return `${Math.round(days * 24)} h ago`
  return `${Math.round(days)} d ago`
}

/** Nearest camera to a point, if one is within maxKm. */
export function nearestCamera<T extends { lat?: number; lon?: number }>(
  cams: T[], lat: number | undefined, lon: number | undefined, maxKm = 1.5,
): T | null {
  if (lat == null || lon == null) return null
  let best: T | null = null
  let bestM = maxKm * 1000
  for (const c of cams) {
    if (c.lat == null || c.lon == null) continue
    const d = getDistanceMeters(lon, lat, c.lon, c.lat)
    if (d < bestM) { bestM = d; best = c }
  }
  return best
}

export const NOW_RADIUS_KM = 40      // closures/delays farther than this are not "now" for us
export const STALE_NOTICE_DAYS = 30  // a low-impact notice older than this is hidden by default

export interface IncidentTriage {
  now: TrafficIncident[]       // closures then delays near us, nearest first within each
  planned: TrafficIncident[]   // low-impact / informational notices worth keeping
  hiddenStale: number          // old low-impact notices left out of `planned`
}

export function triageIncidents(incidents: TrafficIncident[], nowMs = Date.now()): IncidentTriage {
  const now: TrafficIncident[] = []
  const planned: TrafficIncident[] = []
  let hiddenStale = 0
  for (const inc of incidents) {
    const cls = classifyIncident(inc)
    const dist = inc.dist_km ?? (isIncidentInRadius(inc, NOW_RADIUS_KM) ? 0 : Infinity)
    const age = incidentAgeDays(inc, nowMs)
    const near = dist <= NOW_RADIUS_KM
    // A closure stays "now" however old it is (long closures are the point); a delay must be recent.
    if (near && (cls === 'closure' || (cls === 'delay' && (age == null || age <= STALE_NOTICE_DAYS)))) {
      now.push(inc)
    } else if (cls === 'low' && age != null && age > STALE_NOTICE_DAYS) {
      hiddenStale++
    } else {
      planned.push(inc)
    }
  }
  const rank = (i: TrafficIncident) => (classifyIncident(i) === 'closure' ? 0 : 1)
  now.sort((a, b) => rank(a) - rank(b) || (a.dist_km ?? 0) - (b.dist_km ?? 0))
  planned.sort((a, b) => (a.dist_km ?? 999) - (b.dist_km ?? 999))
  return { now, planned, hiddenStale }
}
