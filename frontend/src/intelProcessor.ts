import { NewsItem, SystemEvent } from './storeTypes'

/**
 * A news story the server flagged as an active local emergency
 * (poller news_rank.py: Safety/Weather topic, local, critical whole word)
 * becomes a priority system event. Keyword substring matching used to do
 * this here and turned "Earthquakes beat Timbers" into an intel alert.
 */
export function elevateNewsToEvent(item: NewsItem): SystemEvent | null {
  if (!item.emergency) return null
  return {
    event_id: `intel-elevated-${item.id ?? btoa(item.link || item.title).slice(0, 16)}`,
    event_type: 'intel_alert',
    ts: item.published || new Date().toISOString(),
    severity: 'high',
    summary: `INTEL ALERT: ${item.title}`,
    details: {
      source: item.source,
      topic: item.topic,
      link: item.link,
      original_summary: item.summary,
    },
  }
}
