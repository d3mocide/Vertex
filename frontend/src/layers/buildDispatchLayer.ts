import { IconLayer } from '@deck.gl/layers'
import type { RadioIncident, RadioIncidentCategory } from '../storeTypes'
import { getAtlasIcons } from './atlasIcons'
import { lift, terrainVersion } from './terrainElevation'

/*
 * Dispatch incidents on the main map: located radio incidents (poller
 * radio_incidents.py) from the last few hours. Atlas icons (atlasIcons.ts):
 * the Scope-mark corner brackets say "heard on dispatch", the glyph inside
 * says what kind. Brand signal colours: red emergency for life safety, the
 * P25 amber for everything else significant (P25 radio is its signal), fading
 * with age. Each icon is a solid plate with the glyph knocked out, so it reads
 * as a block of colour beside the outline entity markers. A halo marks
 * anything heard in the last hour, and life safety always keeps a lighter-red
 * halo. Routine calls stay on the Incidents page.
 */

const WINDOW_MS = 6 * 60 * 60 * 1000
const ACTIVE_MS = 60 * 60 * 1000

const RED_EMERGENCY: [number, number, number] = [198, 40, 40]   // #C62828
const AMBER_P25: [number, number, number] = [255, 143, 0]       // #FF8F00
// Lighter red for the life-safety halo — the token red is dim on a dark map.
const RED_HALO: [number, number, number] = [255, 112, 100]

export const DISPATCH_GLYPH: Record<RadioIncidentCategory, string> = {
  water_rescue: 'dispatch_life', rescue: 'dispatch_life', violence: 'dispatch_life',
  train_or_ped_struck: 'dispatch_life',
  structure_fire: 'dispatch_fire', outside_fire: 'dispatch_fire', vehicle_fire: 'dispatch_fire',
  fire: 'dispatch_fire', fire_alarm: 'dispatch_fire',
  gas_leak: 'dispatch_hazard', carbon_monoxide: 'dispatch_hazard', hazmat: 'dispatch_hazard',
  crash: 'dispatch_traffic',
  critical_medical: 'dispatch_life',
  assault: 'dispatch_medical', medical: 'dispatch_medical',
  other: 'dispatch_other',
}

export function dispatchColor(sev: number): [number, number, number] {
  return sev >= 5 ? RED_EMERGENCY : AMBER_P25
}

export function buildDispatchLayers(incidents: RadioIncident[], visible: boolean, nowMs: number, zoom: number) {
  if (!visible) return []
  const data = incidents.filter((i) =>
    i.lat != null && i.lon != null && i.severity >= 3
    && nowMs - Date.parse(i.last_seen) < WINDOW_MS && i.status !== 'cleared')
  if (data.length === 0) return []

  const atlas = getAtlasIcons()
  const alpha = (i: RadioIncident) => {
    const age = Math.min(1, Math.max(0, (nowMs - Date.parse(i.last_seen)) / WINDOW_MS))
    return Math.round(255 - age * 140)
  }
  // Region view: the same small dot other layers use; glyphs from zoom 8.
  const far = zoom < 8
  const haloed = data.filter((i) => i.severity >= 5 || nowMs - Date.parse(i.last_seen) < ACTIVE_MS)
  const minute = Math.floor(nowMs / 60_000)
  const common = {
    iconAtlas: atlas.url,
    iconMapping: atlas.mapping,
    sizeUnits: 'pixels' as const,
    billboard: true,
    getPosition: (i: RadioIncident) => lift(i.lon!, i.lat!),
  }
  return [
    new IconLayer<RadioIncident>({
      ...common,
      id: 'dispatch-incidents-halo',
      data: haloed,
      pickable: false,
      getIcon: () => 'halo',
      getSize: (i) => (far ? 22 : i.severity >= 5 ? 60 : 50),
      getColor: (i) => (i.severity >= 5 ? [...RED_HALO, 150] : [...dispatchColor(i.severity), 110]),
      updateTriggers: { getPosition: terrainVersion(), getSize: [far] },
    }),
    new IconLayer<RadioIncident>({
      ...common,
      id: 'dispatch-incidents',
      data,
      pickable: true,
      getIcon: (i) => (far ? 'dot' : DISPATCH_GLYPH[i.category] ?? 'dispatch_other'),
      getSize: (i) => (far ? (i.severity >= 5 ? 11 : 9) : i.severity >= 5 ? 36 : 32),
      getColor: (i) => [...dispatchColor(i.severity), alpha(i)],
      updateTriggers: { getPosition: terrainVersion(), getIcon: [far], getSize: [far], getColor: [minute] },
    }),
  ]
}
