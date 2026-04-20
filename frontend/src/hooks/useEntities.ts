import { useCivicStore, Entity } from '../store'

export function useEntitiesByType(type: string): Entity[] {
  return Object.values(useCivicStore((s) => s.entities)).filter(
    (e) => e.entity_type === type && e.lat != null && e.lon != null,
  )
}
