import type { SubFilters } from '../storeTypes'

type Kind = 'flag' | 'entity'

export interface LayerDef {
  key: string
  kind: Kind
  label: string
  icon: string
  /** Regional data contract that must have a provider before the layer is offered. */
  contract?: string
}

interface GroupDef { id: string; label: string; layers: LayerDef[] }

export const GROUPS: GroupDef[] = [
  { id: 'live', label: 'Moving traffic', layers: [
    { key: 'aircraft', kind: 'entity', label: 'Aircraft', icon: 'flight' },
    { key: 'vessel', kind: 'entity', label: 'Vessels', icon: 'sailing' },
    { key: 'bus', kind: 'entity', label: 'Buses', icon: 'directions_bus' },
    { key: 'train', kind: 'entity', label: 'Trains', icon: 'directions_railway' },
  ] },
  { id: 'comms', label: 'Communications', layers: [
    { key: 'mesh_node', kind: 'entity', label: 'Mesh nodes', icon: 'hub' },
    { key: 'aprs', kind: 'entity', label: 'APRS', icon: 'sensors' },
  ] },
  { id: 'weather', label: 'Weather', layers: [
    { key: 'radarVisible', kind: 'flag', label: 'Radar', icon: 'radar' },
    { key: 'goesVisible', kind: 'flag', label: 'Infrared', icon: 'satellite_alt' },
    { key: 'smokeVisible', kind: 'flag', label: 'Visible sat', icon: 'filter_drama' },
    { key: 'nwsAlertsVisible', kind: 'flag', label: 'NWS alerts', icon: 'notification_important' },
    { key: 'lightningVisible', kind: 'flag', label: 'Lightning', icon: 'bolt' },
    { key: 'lightningDensityVisible', kind: 'flag', label: 'Strike density', icon: 'electric_bolt' },
  ] },
  { id: 'hazards', label: 'Hazards', layers: [
    { key: 'fire_incident', kind: 'entity', label: 'Fire incidents', icon: 'local_fire_department' },
    { key: 'firePerimetersVisible', kind: 'flag', label: 'Fire perimeters', icon: 'fire_truck' },
    { key: 'fireDangerVisible', kind: 'flag', label: 'Fire danger', icon: 'whatshot', contract: 'fire.danger' },
    { key: 'gaugesVisible', kind: 'flag', label: 'Stream gauges', icon: 'water' },
    { key: 'outagesVisible', kind: 'flag', label: 'Power outages', icon: 'power_off', contract: 'outages.areas' },
  ] },
  { id: 'ops', label: 'Operations', layers: [
    { key: 'dispatchVisible', kind: 'flag', label: 'Dispatch', icon: 'cell_tower' },
    { key: 'geofencesVisible', kind: 'flag', label: 'Zone monitor', icon: 'verified_user' },
  ] },
  { id: 'context', label: 'Map context', layers: [
    { key: 'railTracksVisible', kind: 'flag', label: 'Rail tracks', icon: 'route' },
    { key: 'camerasVisible', kind: 'flag', label: 'Cameras', icon: 'videocam', contract: 'traffic.cameras' },
    { key: 'rf_sensor', kind: 'entity', label: 'RF sensors', icon: 'sensors' },
    { key: 'trailsVisible', kind: 'flag', label: 'Trails', icon: 'timeline' },
  ] },
]

export const ALL_DEFS = GROUPS.flatMap(g => g.layers)

/**
 * A preset is a complete picture of the map: the layers it lists are on and every other layer is off, entity types
 * included, so choosing one never leaves stray clutter behind. 'overview' matches the stock defaults.
 */
export interface Scene { id: string; label: string; on: string[]; sub?: SubFilters }
interface Preset extends Scene { icon: string; hint: string }

export const PRESETS: Preset[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard', hint: 'Aircraft, vessels, significant incidents, lightning and monitored zones',
    on: ['aircraft', 'vessel', 'fire_incident', 'lightningVisible', 'dispatchVisible', 'geofencesVisible'] },
  { id: 'weather', label: 'Weather watch', icon: 'thunderstorm', hint: 'Radar, alerts, lightning, stream gauges and weather stations',
    on: ['radarVisible', 'nwsAlertsVisible', 'lightningVisible', 'gaugesVisible', 'aprs'], sub: { 'aprs.station': ['weather'] } },
  { id: 'fire', label: 'Fire', icon: 'local_fire_department', hint: 'Fire incidents, perimeters, danger, satellite imagery, weather alerts, fire dispatch and response aircraft',
    on: ['fire_incident', 'firePerimetersVisible', 'fireDangerVisible', 'smokeVisible', 'nwsAlertsVisible', 'dispatchVisible', 'aircraft'],
    sub: { 'aircraft.who': ['fire', 'rescue', 'medical'], 'dispatch.category': ['fire'] } },
  { id: 'incidents', label: 'Incidents', icon: 'emergency', hint: 'Radio dispatch, fire incidents, alerts, outages, your zones and emergency-service aircraft',
    on: ['dispatchVisible', 'fire_incident', 'nwsAlertsVisible', 'outagesVisible', 'geofencesVisible', 'aircraft'],
    sub: { 'aircraft.who': ['medical', 'rescue', 'fire', 'law_enforcement', 'alert'] } },
  { id: 'traffic', label: 'Traffic & transit', icon: 'traffic', hint: 'Buses, trains, rail, cameras and crash calls',
    on: ['bus', 'train', 'railTracksVisible', 'camerasVisible', 'dispatchVisible'], sub: { 'dispatch.category': ['traffic'] } },
  { id: 'airsea', label: 'Air & marine', icon: 'flight', hint: 'Aircraft in the air and vessels, with their trails',
    on: ['aircraft', 'vessel', 'trailsVisible'], sub: { 'aircraft.state': ['airborne'] } },
  { id: 'comms', label: 'Radio & mesh', icon: 'cell_tower', hint: 'Mesh nodes, APRS stations and radio dispatch',
    on: ['mesh_node', 'aprs', 'dispatchVisible'] },
]
