import { useMemo } from 'react'
import { useCivicStore, type Entity } from '../store'

const EMPTY: Entity[] = []

export function useEntitiesByType(type: string, enabled = true): Entity[] {
  const select = useMemo(() => {
    let version: number | undefined
    let entities = EMPTY
    return (state: ReturnType<typeof useCivicStore.getState>) => {
      if (!enabled) return EMPTY
      const nextVersion = state.entityTypeVersion[type] ?? 0
      if (version !== nextVersion) {
        version = nextVersion
        entities = Object.values(state.entities).filter(
          entity => entity.entity_type === type && entity.lat != null && entity.lon != null,
        )
      }
      return entities
    }
  }, [type, enabled])
  return useCivicStore(select)
}
