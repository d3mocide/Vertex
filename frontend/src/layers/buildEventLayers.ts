import { ScatterplotLayer } from '@deck.gl/layers'
import type { SystemEvent } from '../store'
import type { RGBA } from './colorUtils'

export function buildEventLayers(events: SystemEvent[], nowMs: number) {
  // Only map events that have geographic coordinates
  const mappedEvents = events.filter(
    (e) => e.details?.lat !== undefined && e.details?.lon !== undefined
  )

  if (mappedEvents.length === 0) return []

  const MS_PER_HOUR = 3600_000
  const MAX_AGE_HOURS = 24

  return [
    new ScatterplotLayer<SystemEvent>({
      id: 'event-points',
      data: mappedEvents,
      pickable: true,
      opacity: 1,
      stroked: true,
      filled: true,
      lineWidthMinPixels: 2,
      getPosition: (d) => [d.details!.lon!, d.details!.lat!],
      getRadius: (d) => {
        // Base size on magnitude if available, otherwise fallback by severity
        if (d.details?.magnitude) {
          return d.details.magnitude * 5000 // M5 = 25km radius
        }
        if (d.severity === 'high') return 20000
        if (d.severity === 'medium') return 10000
        return 5000
      },
      getFillColor: (d): RGBA => {
        const ageMs = nowMs - Date.parse(d.ts)
        const ageHours = Math.max(0, ageMs / MS_PER_HOUR)
        // Fade out as it ages over 24h
        const alpha = Math.max(20, Math.floor(180 * Math.max(0, 1 - ageHours / MAX_AGE_HOURS)))

        if (d.severity === 'high') return [255, 64, 64, alpha]
        if (d.severity === 'medium') return [255, 184, 0, alpha]
        if (d.severity === 'low') return [0, 255, 255, alpha]
        return [200, 200, 200, alpha]
      },
      getLineColor: (d): RGBA => {
        const ageMs = nowMs - Date.parse(d.ts)
        const ageHours = Math.max(0, ageMs / MS_PER_HOUR)
        const alpha = Math.max(50, Math.floor(255 * Math.max(0, 1 - ageHours / MAX_AGE_HOURS)))

        if (d.severity === 'high') return [255, 64, 64, alpha]
        if (d.severity === 'medium') return [255, 184, 0, alpha]
        if (d.severity === 'low') return [0, 255, 255, alpha]
        return [200, 200, 200, alpha]
      },
      // Ensure it updates when 'nowMs' or data changes
      updateTriggers: {
        getFillColor: [nowMs],
        getLineColor: [nowMs],
      },
      // Smooth transitions
      transitions: {
        getRadius: 300,
      },
    }),
  ]
}
