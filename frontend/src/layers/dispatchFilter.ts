import type { RadioIncident, RadioIncidentCategory, SubFilters } from '../storeTypes'

export const DISPATCH_FILTERS = [
  { value: 'fire', label: 'Fire' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'life', label: 'Life safety' },
  { value: 'hazard', label: 'Hazards' },
  { value: 'medical', label: 'Medical' },
  { value: 'other', label: 'Other' },
] as const

const CATEGORIES: Record<RadioIncidentCategory, string> = {
  structure_fire: 'fire', outside_fire: 'fire', vehicle_fire: 'fire', fire: 'fire', fire_alarm: 'fire',
  crash: 'traffic', train_or_ped_struck: 'traffic',
  water_rescue: 'life', rescue: 'life', violence: 'life', critical_medical: 'life',
  hazmat: 'hazard', gas_leak: 'hazard', carbon_monoxide: 'hazard',
  assault: 'medical', medical: 'medical', other: 'other',
}

export function dispatchPassesFilters(incident: RadioIncident, filters: SubFilters): boolean {
  const picked = filters['dispatch.category'] ?? []
  return picked.length === 0 || picked.includes(CATEGORIES[incident.category])
}
