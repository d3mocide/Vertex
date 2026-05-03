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
  const text = ((inc.title || '') + ' ' + (inc.description || '')).toLowerCase()
  const isHighSource = /high|major|severe|critical|closure|crash/i.test(inc.severity ?? '')
  
  // 1. Distance gating (15km radius)
  let isLocal = true
  if (inc.lat != null && inc.lon != null) {
    const dist = getDistanceMeters(DEFAULT_CENTER[0], DEFAULT_CENTER[1], inc.lon, inc.lat)
    isLocal = dist <= 15000 // 15km
  }

  // 2. Mandatory exclusion
  if (text.includes('no impacts') || text.includes('no traffic impacts')) return false
  
  // 3. Keyword-based promotion
  const majorKeywords = ['crash', 'stalled', 'blocked', 'closed', 'closure', 'hazard', 'emergency', 'fire', 'injury', 'fatality']
  const isMajor = majorKeywords.some(kw => text.includes(kw)) || isHighSource

  // 4. Minor keyword mitigation
  const minorKeywords = ['construction', 'maintenance', 'utility work', 'work zone', 'lane shift', 'paving', 'roadwork']
  const isMinor = minorKeywords.some(kw => text.includes(kw)) && !text.includes('closed') && !text.includes('blocked')

  // Rule: Local + Major, or High-Impact Local (unless explicitly minor/construction)
  return isLocal && (isMajor || (!isMinor && isHighSource))
}
