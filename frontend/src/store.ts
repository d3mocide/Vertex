import { create } from 'zustand'

// ─── Entity ───────────────────────────────────────────────────────────────────
export interface Entity {
  entity_id:    string
  entity_type:  string
  source:       string
  display_name?: string
  lat?:         number
  lon?:         number
  altitude?:    number
  heading?:     number
  speed?:       number
  status?:      string
  last_seen?:   string
  identity?:    Record<string, unknown>
  tags?:        string[]
}

// ─── Trail ────────────────────────────────────────────────────────────────────
export interface TrailPoint {
  ts:           string
  lat:          number | null
  lon:          number | null
  altitude?:    number | null
  heading?:     number | null
  speed?:       number | null
}

// ─── Alerts / News ────────────────────────────────────────────────────────────
export interface AlertItem {
  source:    string
  title:     string
  summary:   string
  link:      string
  published: string
}

export interface NewsItem {
  source:    string
  title:     string
  summary?:  string
  link:      string
  published: string
}

// ─── Weather ──────────────────────────────────────────────────────────────────
export interface WeatherAlert {
  event:       string
  headline:    string
  description: string
  severity:    string
  expires:     string
}

export interface WeatherState {
  temp_f?:     number
  wind_mph?:   number
  wind_dir?:   string
  condition?:  string
  humidity?:   number
  aqi?:        number
  aqi_label?:  string
  alerts:      WeatherAlert[]
}

// ─── Radio ────────────────────────────────────────────────────────────────────
export interface RadioState {
  tgid:    number | null
  tag:     string | null
  freq_hz: number | null
  state:   'idle' | 'call' | 'encrypted' | null
  updated: string | null
}

// ─── Traffic Camera ───────────────────────────────────────────────────────────
export interface TrafficCamera {
  id:        string
  name:      string
  url:       string
  ldi_url?:  string
  lat?:      number
  lon?:      number
}

// ─── System Health ────────────────────────────────────────────────────────────
export interface SystemHealth {
  ok:       boolean
  redis:    boolean
  services: Record<string, 'up' | 'down' | 'degraded'>
}

// ─── UI State ─────────────────────────────────────────────────────────────────
export type AppMode  = 'calm' | 'critical'
export type NavTab   = 'safety' | 'infrastructure' | 'environment' | 'community'

// ─── Store ────────────────────────────────────────────────────────────────────
interface CivicStore {
  // Live data
  entities:         Record<string, Entity>
  alerts:           AlertItem[]
  news:             NewsItem[]
  weather:          WeatherState
  radio:            RadioState
  cameras:          TrafficCamera[]
  trail:            TrailPoint[]

  // Connection / health
  connected:        boolean
  health:           SystemHealth

  // UI
  mode:             AppMode
  activeTab:        NavTab
  selectedEntityId: string | null
  ldiMode:          boolean          // Last Daylight Image toggle for cameras

  // Actions — data
  setEntities:      (entities: Entity[]) => void
  upsertEntity:     (entity: Entity) => void
  purgeStaleEntities: () => void
  setAlerts:        (alerts: AlertItem[]) => void
  setNews:          (news: NewsItem[]) => void
  setWeather:       (weather: Partial<WeatherState>) => void
  setRadio:         (radio: RadioState) => void
  setCameras:       (cameras: TrafficCamera[]) => void
  setTrail:         (trail: TrailPoint[]) => void

  // Actions — connection
  setConnected:     (v: boolean) => void
  setHealth:        (h: Partial<SystemHealth>) => void

  // Actions — UI
  setMode:          (mode: AppMode) => void
  setActiveTab:     (tab: NavTab) => void
  selectEntity:     (id: string | null) => void
  setLdiMode:       (v: boolean) => void
}

const emptyRadio: RadioState = {
  tgid: null, tag: null, freq_hz: null, state: null, updated: null,
}

const defaultWeather: WeatherState = {
  temp_f: undefined, wind_mph: undefined, wind_dir: undefined,
  condition: undefined, humidity: undefined,
  aqi: undefined, aqi_label: undefined,
  alerts: [],
}

const defaultHealth: SystemHealth = {
  ok: false, redis: false, services: {},
}

export const useCivicStore = create<CivicStore>((set) => ({
  // Data
  entities:         {},
  alerts:           [],
  news:             [],
  weather:          defaultWeather,
  radio:            emptyRadio,
  cameras:          [],
  trail:            [],

  // Connection
  connected:        false,
  health:           defaultHealth,

  // UI
  mode:             'calm',
  activeTab:        'safety',
  selectedEntityId: null,
  ldiMode:          false,

  // Data actions
  setEntities:  (list) =>
    set({ entities: Object.fromEntries(list.map((e) => [e.entity_id, e])) }),
  upsertEntity: (entity) =>
    set((s) => ({ entities: { ...s.entities, [entity.entity_id]: entity } })),
  purgeStaleEntities: () =>
    set((s) => {
      const now = Date.now()
      const next = { ...s.entities }
      let changed = false
      for (const [id, e] of Object.entries(next)) {
        if (e.entity_type === 'aircraft' && e.last_seen) {
          const age = now - new Date(e.last_seen).getTime()
          if (age > 60_000) {
            delete next[id]
            changed = true
          }
        }
      }
      return changed ? { entities: next } : {}
    }),
  setAlerts:    (alerts)  => set({ alerts }),
  setNews:      (news)    => set({ news }),
  setWeather:   (patch)   => set((s) => ({ weather: { ...s.weather, ...patch } })),
  setRadio:     (radio)   => set({ radio }),
  setCameras:   (cameras) => set({ cameras }),
  setTrail:     (trail)   => set({ trail }),

  // Connection actions
  setConnected: (connected) => set({ connected }),
  setHealth:    (patch) =>
    set((s) => ({ health: { ...s.health, ...patch } })),

  // UI actions
  setMode:      (mode)      => set({ mode }),
  setActiveTab: (activeTab) => set({ activeTab }),
  selectEntity: (selectedEntityId) => set({ selectedEntityId }),
  setLdiMode:   (ldiMode)   => set({ ldiMode }),
}))
