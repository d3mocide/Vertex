import { ScatterplotLayer } from '@deck.gl/layers'
import type { RadioIncident } from '../storeTypes'

/*
 * Dispatch incidents on the main map: located radio incidents (poller
 * radio_incidents.py) from the last few hours, coloured like the Incidents
 * page pins — red life safety, amber serious, grey routine — fading with
 * age. Routine calls are left off here; the Incidents page lists them.
 */

const WINDOW_MS = 6 * 60 * 60 * 1000
const ACTIVE_MS = 60 * 60 * 1000

const RED: [number, number, number] = [198, 40, 40]      // --red-emergency
const AMBER: [number, number, number] = [255, 184, 0]    // --amber-gold
const GREY: [number, number, number] = [140, 140, 140]

export function dispatchColor(sev: number): [number, number, number] {
  return sev >= 5 ? RED : sev >= 3 ? AMBER : GREY
}

export function buildDispatchLayers(incidents: RadioIncident[], visible: boolean, nowMs: number) {
  if (!visible) return []
  const data = incidents.filter((i) =>
    i.lat != null && i.lon != null && i.severity >= 3
    && nowMs - Date.parse(i.last_seen) < WINDOW_MS && i.status !== 'cleared')
  if (data.length === 0) return []
  const alpha = (i: RadioIncident) => {
    const age = Math.min(1, Math.max(0, (nowMs - Date.parse(i.last_seen)) / WINDOW_MS))
    return Math.round(235 - age * 150)
  }
  const recent = data.filter((i) => nowMs - Date.parse(i.last_seen) < ACTIVE_MS)
  return [
    // Halo on anything heard in the last hour.
    new ScatterplotLayer<RadioIncident>({
      id: 'dispatch-incidents-halo',
      data: recent,
      pickable: false,
      stroked: true,
      filled: false,
      radiusUnits: 'pixels',
      getRadius: (i) => (i.severity >= 5 ? 16 : 12),
      lineWidthUnits: 'pixels',
      getLineWidth: 2,
      getLineColor: (i) => [...dispatchColor(i.severity), 150],
      getPosition: (i) => [i.lon!, i.lat!],
    }),
    new ScatterplotLayer<RadioIncident>({
      id: 'dispatch-incidents',
      data,
      pickable: true,
      stroked: true,
      radiusUnits: 'pixels',
      getRadius: (i) => (i.severity >= 5 ? 8 : 6),
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      getFillColor: (i) => [...dispatchColor(i.severity), alpha(i)],
      getLineColor: [5, 5, 5, 220],
      getPosition: (i) => [i.lon!, i.lat!],
      updateTriggers: { getFillColor: [Math.floor(nowMs / 60_000)] },
    }),
  ]
}
