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
