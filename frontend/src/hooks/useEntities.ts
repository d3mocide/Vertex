import { useShallow } from 'zustand/react/shallow'
import { useCivicStore, Entity } from '../store'

export function useEntitiesByType(type: string): Entity[] {
  return useCivicStore(
    useShallow((s) =>
      Object.values(s.entities).filter(
        (e) => e.entity_type === type && e.lat != null && e.lon != null,
      ),
    ),
  )
}
