/**
 * Sub-filters for entity types: kinds of aircraft, vessels, APRS stations and mesh nodes.
 *
 * A facet lists the values an entity can have; a filter selects some of them. Nothing selected means show everything
 * (so existing behaviour is unchanged), several selected values mean "any of these", and different facets of one entity
 * type must all match. The values come from the poller's enrichment (aircraft_class, military, role, ship_category,
 * station_type, contact_type); entities whose data is missing fall into "unknown" or "other" rather than disappearing
 * unless a filter excludes them.
 */
import type { Entity, SubFilters, Track } from './storeTypes'

export type FacetEntity = 'aircraft' | 'vessel' | 'aprs' | 'mesh_node'

export interface FacetOption { value: string; label: string }

export interface Facet {
  id: string
  entity: FacetEntity
  label: string
  options: FacetOption[]
}

export const FACETS: Facet[] = [
  { id: 'aircraft.kind', entity: 'aircraft', label: 'Kind', options: [
    { value: 'airliner', label: 'Airliners' }, { value: 'business', label: 'Business & regional' },
    { value: 'light', label: 'Light' }, { value: 'helicopter', label: 'Helicopters' },
    { value: 'highperf', label: 'High performance' }, { value: 'glider', label: 'Gliders & balloons' },
    { value: 'uav', label: 'Drones' }, { value: 'ground', label: 'Ground vehicles' }, { value: 'unknown', label: 'Unknown' },
  ] },
  { id: 'aircraft.state', entity: 'aircraft', label: 'State', options: [
    { value: 'airborne', label: 'In the air' }, { value: 'ground', label: 'On the ground' },
  ] },
  { id: 'aircraft.who', entity: 'aircraft', label: 'Who', options: [
    { value: 'medical', label: 'Air ambulance' }, { value: 'rescue', label: 'Search & rescue' },
    { value: 'fire', label: 'Firefighting' }, { value: 'law_enforcement', label: 'Law enforcement' },
    { value: 'military', label: 'Military' }, { value: 'government', label: 'Government' },
    { value: 'news', label: 'News' }, { value: 'alert', label: 'Emergency squawk' },
  ] },
  { id: 'vessel.type', entity: 'vessel', label: 'Type', options: [
    { value: 'cargo', label: 'Cargo' }, { value: 'tanker', label: 'Tanker' }, { value: 'passenger', label: 'Passenger' },
    { value: 'tug', label: 'Tug & tow' }, { value: 'fishing', label: 'Fishing' }, { value: 'recreational', label: 'Pleasure & sail' },
    { value: 'service', label: 'Pilot, SAR & service' }, { value: 'military', label: 'Military' },
    { value: 'other', label: 'Other' }, { value: 'unknown', label: 'Unknown' },
  ] },
  { id: 'vessel.motion', entity: 'vessel', label: 'Status', options: [
    { value: 'moving', label: 'Under way' }, { value: 'stationary', label: 'Moored or anchored' },
  ] },
  { id: 'aprs.station', entity: 'aprs', label: 'Station', options: [
    { value: 'weather', label: 'Weather' }, { value: 'infrastructure', label: 'Digipeaters & gateways' },
    { value: 'fixed', label: 'Fixed' }, { value: 'mobile', label: 'Mobile' }, { value: 'emergency', label: 'Emergency' },
    { value: 'other', label: 'Other' },
  ] },
  { id: 'mesh.node', entity: 'mesh_node', label: 'Node', options: [
    { value: 'repeater', label: 'Repeaters' }, { value: 'chat', label: 'Chat nodes' }, { value: 'room', label: 'Room servers' },
    { value: 'sensor', label: 'Sensors' }, { value: 'unknown', label: 'Unknown' },
  ] },
]

export const facetsFor = (entity: FacetEntity): Facet[] => FACETS.filter(f => f.entity === entity)

const SHIP_BUCKET: Record<string, string> = {
  cargo: 'cargo', tanker: 'tanker', passenger: 'passenger', tug: 'tug', fishing: 'fishing',
  recreational: 'recreational', sailing: 'recreational', special: 'service', sar: 'service', military: 'military',
}
const SHIP_LABEL_BUCKET: [RegExp, string][] = [
  [/^cargo/i, 'cargo'], [/^tanker/i, 'tanker'], [/^passenger/i, 'passenger'], [/^(tug|towing)/i, 'tug'],
  [/^fishing/i, 'fishing'], [/^(pleasure|sailing)/i, 'recreational'], [/^(pilot|search|law|medical|port tender|anti-pollution|dredging|diving)/i, 'service'],
  [/^(military|noncombatant)/i, 'military'],
]

/** The facet bucket of a vessel; vessels recorded before the poller stored a bucket fall back to the type label. */
export function vesselBucket(category: string | undefined, label: string | undefined): string {
  if (category) return SHIP_BUCKET[category] ?? 'other'
  if (label) return SHIP_LABEL_BUCKET.find(([re]) => re.test(label))?.[1] ?? 'other'
  return 'unknown'
}

const MESH_TYPE: Record<string, string> = { repeater: 'repeater', 'chat node': 'chat', 'room server': 'room', sensor: 'sensor' }

export function meshBucket(contactType: unknown): string {
  return MESH_TYPE[String(contactType ?? '').trim().toLowerCase()] ?? 'unknown'
}

const APRS_STATIONS = new Set(['weather', 'infrastructure', 'fixed', 'mobile', 'emergency'])

/** The values of one facet that apply to a track (several for 'who': a military helicopter is both). */
export function trackValues(track: Track, facetId: string): string[] {
  switch (facetId) {
    case 'aircraft.kind': return [track.aircraftClass || 'unknown']
    case 'aircraft.state': return [track.onGround ? 'ground' : 'airborne']
    case 'aircraft.who': {
      const out: string[] = []
      if (track.role) out.push(track.role)
      if (track.military && !out.includes('military')) out.push('military')
      if (track.alert) out.push('alert')
      return out
    }
    case 'vessel.type': return [vesselBucket(track.shipCategory, track.shipType)]
    case 'vessel.motion': return [track.vesselStationary ? 'stationary' : 'moving']
    case 'aprs.station': return [APRS_STATIONS.has(track.stationType ?? '') ? track.stationType! : 'other']
    default: return []
  }
}

export function meshValues(entity: Entity, facetId: string): string[] {
  return facetId === 'mesh.node' ? [meshBucket(entity.identity?.contact_type)] : []
}

const TRACK_TYPE_ENTITY: Partial<Record<Track['type'], FacetEntity>> = { air: 'aircraft', sea: 'vessel', ground: 'aprs' }

/** True when the active sub-filters leave this track visible. */
export function trackPassesFacets(track: Track, filters: SubFilters): boolean {
  const entity = TRACK_TYPE_ENTITY[track.type]
  if (!entity) return true
  for (const facet of facetsFor(entity)) {
    const selected = filters[facet.id]
    if (!selected || selected.length === 0) continue
    if (!trackValues(track, facet.id).some(v => selected.includes(v))) return false
  }
  return true
}

export function meshPassesFacets(node: Entity, filters: SubFilters): boolean {
  for (const facet of facetsFor('mesh_node')) {
    const selected = filters[facet.id]
    if (!selected || selected.length === 0) continue
    if (!meshValues(node, facet.id).some(v => selected.includes(v))) return false
  }
  return true
}

/** Number of facet options selected for an entity type, for the badge on its tile. */
export function activeFacetCount(entity: FacetEntity, filters: SubFilters): number {
  return facetsFor(entity).reduce((n, f) => n + (filters[f.id]?.length ?? 0), 0)
}
