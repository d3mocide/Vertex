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

/** Closed, slowed, or just a notice. The poller decides (words + ODOT event codes); older data falls back to the rating. */
export function classifyIncident(inc: TrafficIncident): IncidentClass {
  if (inc.kind) return inc.kind
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

/** Days since ODOT first reported it (falls back to the last update). */
export function incidentSinceDays(inc: TrafficIncident, now = Date.now()): number | null {
  const t = inc.start ? Date.parse(inc.start) : NaN
  return Number.isNaN(t) ? incidentAgeDays(inc, now) : Math.max(0, (now - t) / 86_400_000)
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

export const NOW_RADIUS_KM = 40        // closures/delays farther than this are not "now" for us
export const EVENT_RADIUS_KM = 60      // …but a crash or hazard is worth knowing about from farther
export const DELAY_FRESH_DAYS = 7      // a routine delay notice not touched for a week is planned work
export const STALE_NOTICE_DAYS = 30    // a low-impact notice older than this is hidden by default
export const NEW_DAYS = 2              // a closure this recent is news even if it is only a ramp

/** One thing to show: a lone incident, or a project's closures folded under the one that matters. */
export interface IncidentGroup {
  key: string
  lead: TrafficIncident
  members: TrafficIncident[]           // the rest of the cluster (ramps that come with a road closure)
  kind: 'closure' | 'delay'
  scope: 'road' | 'ramp' | null
  unplanned: boolean
  highlight: boolean                   // worth the top of the page
  sinceDays: number | null             // oldest member: how long this has been going on
  newestDays: number | null            // most recent member: how fresh it is
}

export interface IncidentTriage {
  now: IncidentGroup[]
  planned: TrafficIncident[]           // low-impact notices and far/old items worth keeping
  hiddenStale: number                  // old low-impact notices left out of `planned`
}

const min = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.min(...v) : null }
const max = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.max(...v) : null }

export function triageIncidents(incidents: TrafficIncident[], nowMs = Date.now()): IncidentTriage {
  const planned: TrafficIncident[] = []
  let hiddenStale = 0
  const clusters = new Map<string, TrafficIncident[]>()

  for (const inc of incidents) {
    const kind = classifyIncident(inc)
    const dist = inc.dist_km ?? (isIncidentInRadius(inc, NOW_RADIUS_KM) ? 0 : Infinity)
    const updated = incidentAgeDays(inc, nowMs)
    const unplanned = !!inc.unplanned
    let now = false
    if (unplanned && kind !== 'low') now = dist <= EVENT_RADIUS_KM
    else if (kind === 'closure') now = dist <= NOW_RADIUS_KM
    else if (kind === 'delay') now = dist <= NOW_RADIUS_KM && (updated == null || updated <= DELAY_FRESH_DAYS)

    if (now) {
      // Closures cluster (poller `group`); everything else stands alone.
      const key = kind === 'closure' && inc.group ? inc.group : `solo-${clusters.size}-${inc.title}`
      clusters.set(key, [...(clusters.get(key) ?? []), inc])
    } else if (kind === 'low' && updated != null && updated > STALE_NOTICE_DAYS) {
      hiddenStale++
    } else {
      planned.push(inc)
    }
  }

  const groups: IncidentGroup[] = []
  for (const [key, all] of clusters) {
    const lead = all.find((m) => m.lead) ?? [...all].sort((a, b) => Number(b.scope === 'road') - Number(a.scope === 'road'))[0]
    const members = all.filter((m) => m !== lead)
    const kind = classifyIncident(lead) === 'closure' || members.length ? 'closure' : 'delay'
    const scope = all.some((m) => m.scope === 'road') ? 'road' : all.some((m) => m.scope === 'ramp') ? 'ramp' : null
    const unplanned = all.some((m) => m.unplanned)
    const newestDays = min(all.map((m) => incidentSinceDays(m, nowMs)))
    const sinceDays = max(all.map((m) => incidentSinceDays(m, nowMs)))
    // Highlight what a driver would want to know first: crashes and hazards, a road that is actually
    // shut, or anything that just happened. A weeks-old ramp closure is real but background.
    const highlight = unplanned || scope === 'road' || (newestDays != null && newestDays <= NEW_DAYS)
    groups.push({ key, lead, members, kind, scope, unplanned, highlight, sinceDays, newestDays })
  }

  const tier = (g: IncidentGroup) =>
    g.unplanned ? 0 : g.kind === 'closure' && g.scope === 'road' ? 1 : g.highlight && g.kind === 'closure' ? 2 : g.kind === 'closure' ? 3 : 4
  groups.sort((a, b) => tier(a) - tier(b) || (a.lead.dist_km ?? 999) - (b.lead.dist_km ?? 999))
  planned.sort((a, b) => (a.dist_km ?? 999) - (b.dist_km ?? 999))
  return { now: groups, planned, hiddenStale }
}
