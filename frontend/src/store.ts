import { create } from 'zustand'

export interface Entity {
  entity_id: string
  entity_type: string
  source: string
  display_name?: string
  lat?: number
  lon?: number
  altitude?: number
  heading?: number
  speed?: number
  status?: string
  last_seen?: string
  identity?: Record<string, unknown>
  tags?: string[]
}

export interface AlertItem {
  source: string
  title: string
  summary: string
  link: string
  published: string
}

interface CivicStore {
  entities: Record<string, Entity>
  alerts: AlertItem[]
  weather: Record<string, unknown>
  connected: boolean
  selectedEntityId: string | null
  setEntities: (entities: Entity[]) => void
  upsertEntity: (entity: Entity) => void
  setAlerts: (alerts: AlertItem[]) => void
  setWeather: (weather: Record<string, unknown>) => void
  setConnected: (v: boolean) => void
  selectEntity: (id: string | null) => void
}

export const useCivicStore = create<CivicStore>((set) => ({
  entities: {},
  alerts: [],
  weather: {},
  connected: false,
  selectedEntityId: null,
  setEntities: (list) =>
    set({ entities: Object.fromEntries(list.map((e) => [e.entity_id, e])) }),
  upsertEntity: (entity) =>
    set((s) => ({ entities: { ...s.entities, [entity.entity_id]: entity } })),
  setAlerts: (alerts) => set({ alerts }),
  setWeather: (weather) => set({ weather }),
  setConnected: (connected) => set({ connected }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
}))
