import { NewsItem, SystemEvent } from './storeTypes'

export const CRITICAL_KEYWORDS = [
  'earthquake', 'quake', 'tsunami', 'wildfire', 'shooting', 
  'active shooter', 'evacuation', 'hazmat', 'flood', 'tornado',
  'casualty', 'explosion', 'blackout', 'derailment', 'outage'
]

/**
 * Scans a news item for critical tactical keywords.
 * Returns a SystemEvent if a match is found, otherwise null.
 */
export function elevateNewsToEvent(item: NewsItem): SystemEvent | null {
  const text = `${item.title} ${item.summary || ''}`.toLowerCase()
  const match = CRITICAL_KEYWORDS.find(k => text.includes(k))

  if (!match) return null

  // Use a predictable ID based on the link or title to prevent duplicates
  const event_id = `intel-elevated-${btoa(item.link || item.title).slice(0, 16)}`

  return {
    event_id,
    event_type: 'intel_alert',
    ts: item.published || new Date().toISOString(),
    severity: 'high',
    summary: `INTEL ALERT: ${item.title}`,
    details: {
      source: item.source,
      keyword: match,
      link: item.link,
      original_summary: item.summary
    }
  }
}
