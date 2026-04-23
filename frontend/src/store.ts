import { create } from 'zustand'
import { chaikinSmooth, destinationPoint } from './layers/geoUtils'

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

// ─── Deck.gl Track Model ──────────────────────────────────────────────────────
// Compact tuple: [lon, lat, altMeters, speedMs, ts?]
export type TrailPt = [number, number, number, number, string?]

export interface Track {
  uid:           string
  lat:           number
  lon:           number
  altMeters:     number        // metres MSL (0 for vessels)
  speedMs:       number        // m/s
  courseTrue:    number        // 0–360°, true north
  type:          'air' | 'sea'
  callsign?:     string
  category?:     string
  trail:         TrailPt[]     // raw history, newest last, capped at 150 pts
  smoothedTrail: number[][]    // [[lon,lat],...] after 2× Chaikin
  predictedPath: [number, number][]
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
  dist_km?:  number
  road?:     string
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
  tracks:           Record<string, Track>
  alerts:           AlertItem[]
  news:             NewsItem[]
  weather:          WeatherState
  radio:            RadioState
  cameras:          TrafficCamera[]
  trafficFlow:      any[]
  utilityStatus:    any
  trail:            TrailPoint[]

  // Connection / health
  connected:        boolean
  health:           SystemHealth

  // UI
  mode:             AppMode
  activeTab:        NavTab
  selectedEntityId: string | null
  ldiMode:          boolean          // Last Daylight Image toggle for cameras
  radarVisible:     boolean
  radarOpacity:     number

  // Actions — data
  setEntities:      (entities: Entity[]) => void
  upsertEntity:     (entity: Entity) => void
  purgeStaleEntities: () => void
  setAlerts:        (alerts: AlertItem[]) => void
  setNews:          (news: NewsItem[]) => void
  setWeather:       (weather: Partial<WeatherState>) => void
  setRadio:         (radio: RadioState) => void
  setCameras:       (cameras: TrafficCamera[]) => void
  setTrafficFlow:   (flow: any[]) => void
  setUtilityStatus: (status: any) => void
  setTrail:         (trail: TrailPoint[]) => void

  // Actions — connection
  setConnected:     (v: boolean) => void
  setHealth:        (h: Partial<SystemHealth>) => void

  // Actions — UI
  setMode:          (mode: AppMode) => void
  setActiveTab:     (tab: NavTab) => void
  selectEntity:     (id: string | null) => void
  setLdiMode:       (v: boolean) => void
  setRadarVisible:  (v: boolean) => void
  setRadarOpacity:  (v: number) => void

  // Camera map interaction
  selectedCamId:    string | null
  setSelectedCamId: (id: string | null) => void

  // Camera favorites (persisted to localStorage)
  favoriteCamIds:    string[]
  toggleFavoriteCam: (id: string) => void
}

// ─── Entity → Track conversion ────────────────────────────────────────────────
const ALT_FT_TO_M  = 0.3048
const SPD_KT_TO_MS = 0.5144
const TRAIL_CAP    = 150
const PRED_STEP_S  = 20
const PRED_STEPS   = 3

function entityToTrack(entity: Entity, existing?: Track): Track | null {
  if (entity.lat == null || entity.lon == null) return null
  const isAir = entity.entity_type === 'aircraft'
  if (!isAir && entity.entity_type !== 'vessel') return null

  const altMeters  = isAir ? (entity.altitude ?? 0) * ALT_FT_TO_M : 0
  const speedMs    = (entity.speed ?? 0) * SPD_KT_TO_MS
  const courseTrue = entity.heading ?? 0

  const newPt: TrailPt = [entity.lon, entity.lat, altMeters, speedMs, entity.last_seen]
  const trail = [...(existing?.trail ?? []), newPt].slice(-TRAIL_CAP)

  const smoothedTrail = trail.length >= 2
    ? chaikinSmooth(trail.map(p => [p[0], p[1]]), 2)
    : []

  const predictedPath: [number, number][] = []
  if (speedMs >= 0.5) {
    for (let i = 1; i <= PRED_STEPS; i++) {
      predictedPath.push(destinationPoint(entity.lon, entity.lat, courseTrue, speedMs * PRED_STEP_S * i))
    }
  }

  return {
    uid:          entity.entity_id,
    lat:          entity.lat,
    lon:          entity.lon,
    altMeters,
    speedMs,
    courseTrue,
    type:         isAir ? 'air' : 'sea',
    callsign:     entity.display_name,
    category:     entity.tags?.[0],
    trail,
    smoothedTrail,
    predictedPath,
  }
}

function loadFavoriteCamIds(): string[] {
  try { return JSON.parse(localStorage.getItem('favoriteCamIds') ?? '[]') }
  catch { return [] }
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
  tracks:           {},
  alerts:           [],
  news:             [],
  weather:          defaultWeather,
  radio:            emptyRadio,
  cameras:          [],
  trafficFlow:      [],
  utilityStatus:    null,
  trail:            [],

  // Connection
  connected:        false,
  health:           defaultHealth,

  // UI
  mode:             'calm',
  activeTab:        'safety',
  selectedEntityId: null,
  ldiMode:          false,
  radarVisible:     false,
  radarOpacity:     0.6,
  selectedCamId:    null,
  favoriteCamIds:   loadFavoriteCamIds(),

  // Data actions
  setEntities: (list) => {
    const entities = Object.fromEntries(list.map((e) => [e.entity_id, e]))
    const tracks: Record<string, Track> = {}
    for (const e of list) {
      const t = entityToTrack(e)
      if (t) tracks[t.uid] = t
    }
    set({ entities, tracks })
  },
  upsertEntity: (entity) =>
    set((s) => {
      const track = entityToTrack(entity, s.tracks[entity.entity_id])
      return {
        entities: { ...s.entities, [entity.entity_id]: entity },
        tracks: track ? { ...s.tracks, [entity.entity_id]: track } : s.tracks,
      }
    }),
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
      if (!changed) return {}
      const nextTracks = { ...s.tracks }
      for (const id of Object.keys(s.tracks)) {
        if (!(id in next)) delete nextTracks[id]
      }
      return { entities: next, tracks: nextTracks }
    }),
  setAlerts:    (alerts)  => set({ alerts }),
  setNews:      (news)    => set({ news }),
  setWeather:   (patch)   => set((s) => ({ weather: { ...s.weather, ...patch } })),
  setRadio:     (radio)   => set({ radio }),
  setCameras:   (cameras) => set({ cameras }),
  setTrafficFlow: (trafficFlow) => set({ trafficFlow }),
  setUtilityStatus: (utilityStatus) => set({ utilityStatus }),
  setTrail:     (trail)   => set({ trail }),

  // Connection actions
  setConnected: (connected) => set({ connected }),
  setHealth:    (patch) =>
    set((s) => ({ health: { ...s.health, ...patch } })),

  // UI actions
  setMode:         (mode)         => set({ mode }),
  setActiveTab:    (activeTab)    => set({ activeTab }),
  selectEntity:    (selectedEntityId) => set({ selectedEntityId }),
  setLdiMode:      (ldiMode)      => set({ ldiMode }),
  setRadarVisible: (radarVisible) => set({ radarVisible }),
  setRadarOpacity: (radarOpacity) => set({ radarOpacity }),
  setSelectedCamId: (selectedCamId) => set({ selectedCamId }),
  toggleFavoriteCam: (id) =>
    set((s) => {
      const next = s.favoriteCamIds.includes(id)
        ? s.favoriteCamIds.filter((f) => f !== id)
        : [...s.favoriteCamIds, id]
      localStorage.setItem('favoriteCamIds', JSON.stringify(next))
      return { favoriteCamIds: next }
    }),
}))
