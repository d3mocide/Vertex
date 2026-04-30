import { create } from 'zustand'
import { chaikinSmooth, filterTrailSpikes, destinationPoint } from './layers/geoUtils'

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
  vertical_rate?: number
  distance_km?: number
  status?:      string
  last_seen?:   string
  identity?:    Record<string, unknown>
  tags?:        string[]
  // Server-side position ring buffer emitted by the BEAST decoder.
  // Each entry: [lat, lon, alt_ft, unix_ts_seconds]
  trail_pts?:   [number, number, number, number][]
}

export interface TrafficIncident {
  title: string
  description?: string
  location?: string
  link?: string
  pubDate?: string
  lat?: number
  lon?: number
  severity?: string
}

export interface SummaryState {
  summary: string
  ts: string | null
  model: string | null
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

export interface AirportSnapshot {
  name?: string
  lat?: number
  lon?: number
  metar?: Record<string, unknown> | null
}

// ─── Alerts / News ────────────────────────────────────────────────────────────
export interface AlertItem {
  source:    string
  title:     string
  summary:   string
  link:      string
  published: string
  category?:  string
}

export interface NewsItem {
  source:    string
  title:     string
  summary?:  string
  link:      string
  published: string
  category?:  string
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
  id:          string
  name:        string
  url:         string
  ldi_url?:    string
  lat?:        number
  lon?:        number
  dist_km?:    number
  road?:       string
  health?:     'ok' | 'warn' | 'down' | 'unknown'
  last_ok_ts?: number | null
}

// ─── System Events ────────────────────────────────────────────────────────────
export interface SystemEvent {
  event_id:   string
  event_type: string
  entity_id?: string
  ts:         string
  severity:   string
  summary:    string
  details?:   Record<string, unknown>
}

// ─── System Health ────────────────────────────────────────────────────────────
export interface SystemHealth {
  ok:       boolean
  redis:    boolean
  services: Record<string, 'up' | 'down' | 'degraded'>
}

// ─── UI State ─────────────────────────────────────────────────────────────────
export type AppMode  = 'calm' | 'critical'
export type NavTab   = 'safety' | 'infrastructure' | 'environment' | 'community' | 'events'
export type EntityTypeFilter = { aircraft: boolean; vessel: boolean; mesh_node: boolean }

// [min, max] — altitude in feet, speed in knots
export type RangeFilter = [number, number]

export const ALT_RANGE_DEFAULT: RangeFilter  = [0, 60_000]
export const SPD_RANGE_DEFAULT: RangeFilter  = [0, 600]

// ─── Replay ───────────────────────────────────────────────────────────────────
export interface ReplayPoint {
  ts:        string
  lat:       number
  lon:       number
  altitude:  number | null
  heading:   number | null
  speed:     number | null
}

export interface ReplayEntityData {
  entity_type:  string
  display_name: string | null
  points:       ReplayPoint[]
}

export interface ReplayData {
  start:    string
  end:      string
  entities: Record<string, ReplayEntityData>
  events?:  ReplayEvent[]
}

export interface ReplayEvent {
  event_id:   string
  event_type: string
  entity_id?: string | null
  ts:         string
  severity:   string
  summary:    string
}

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
  trafficIncidents: TrafficIncident[]
  utilityStatus:    any
  oregonStatus:     any
  trail:            TrailPoint[]
  airports:         Record<string, AirportSnapshot>
  summary:          SummaryState

  // Event log (ring buffer, capped at 100)
  systemEvents:     SystemEvent[]

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
  camerasVisible:   boolean
  geofencesVisible: boolean

  // Actions — data
  setEntities:      (entities: Entity[]) => void
  setAircraftSnapshot: (entities: Entity[]) => void
  upsertEntity:     (entity: Entity) => void
  purgeStaleEntities: () => void
  appendSystemEvent: (event: SystemEvent) => void
  setSystemEvents:  (events: SystemEvent[]) => void
  setAlerts:        (alerts: AlertItem[]) => void
  setNews:          (news: NewsItem[]) => void
  setWeather:       (weather: Partial<WeatherState>) => void
  setRadio:         (radio: RadioState) => void
  setCameras:       (cameras: TrafficCamera[]) => void
  setTrafficFlow:   (flow: any[]) => void
  setTrafficIncidents: (incidents: TrafficIncident[]) => void
  setUtilityStatus: (status: any) => void
  setOregonStatus:  (status: any) => void
  setTrail:         (trail: TrailPoint[]) => void
  setAirports:      (airports: Record<string, AirportSnapshot>) => void
  setSummary:       (summary: Partial<SummaryState>) => void

  // Actions — connection
  setConnected:     (v: boolean) => void
  setHealth:        (h: Partial<SystemHealth>) => void

  // Actions — UI
  setMode:             (mode: AppMode) => void
  setActiveTab:        (tab: NavTab) => void
  selectEntity:        (id: string | null) => void
  setLdiMode:          (v: boolean) => void
  setRadarVisible:     (v: boolean) => void
  setRadarOpacity:     (v: number) => void
  setCamerasVisible:   (v: boolean) => void
  setGeofencesVisible: (v: boolean) => void
  mobileNavOpen:       boolean
  setMobileNavOpen:    (v: boolean) => void
  settingsOpen:        boolean
  setSettingsOpen:     (v: boolean) => void
  entityFilter:        EntityTypeFilter
  setEntityFilter:     (f: Partial<EntityTypeFilter>) => void
  entitySearchQuery:   string
  setEntitySearchQuery: (q: string) => void
  entityAltRange:      RangeFilter
  setEntityAltRange:   (r: RangeFilter) => void
  entitySpeedRange:    RangeFilter
  setEntitySpeedRange: (r: RangeFilter) => void

  // Geofence draw tool
  geofenceDrawing:      boolean
  geofenceDrawPoints:   [number, number][]   // [lon, lat] pairs
  setGeofenceDrawing:   (v: boolean) => void
  addGeofenceDrawPoint: (pt: [number, number]) => void
  clearGeofenceDrawPoints: () => void

  // Replay mode
  replayMode:         boolean
  replayData:         ReplayData | null
  replayCurrentTs:    number       // Unix ms — current playhead position
  replayPlaying:      boolean
  replaySpeed:        number       // 1 | 2 | 5 | 10
  setReplayMode:      (v: boolean) => void
  setReplayData:      (d: ReplayData | null) => void
  setReplayCurrentTs: (ts: number) => void
  setReplayPlaying:   (v: boolean) => void
  setReplaySpeed:     (v: number) => void

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

  // ── Build raw trail ──────────────────────────────────────────────────────
  // Prefer the server-side position ring buffer (trail_pts) when available.
  // It is emitted by the BEAST decoder and contains every resolved CPR fix,
  // giving us a much denser history than the 1-pt/sec client accumulation.
  let trail: TrailPt[]

  if (entity.trail_pts && entity.trail_pts.length >= 2) {
    // Convert server trail: [lat, lon, alt_ft, unix_ts] → TrailPt [lon, lat, altM, speedMs, ts]
    const serverTrail: TrailPt[] = entity.trail_pts.map(p => [
      p[1],                         // lon
      p[0],                         // lat
      p[2] * ALT_FT_TO_M,           // alt_ft → metres
      speedMs,                      // speed not stored per-point; use current
      new Date(p[3] * 1000).toISOString(), // unix_ts → ISO string
    ])

    // Trim to the most recent continuous tracking segment.
    // A gap > MAX_TRAIL_GAP_SEC between consecutive positions means BEAST lost
    // the aircraft and later reacquired it — older segments produce a ghost trail
    // detached from the current icon.
    // 60 s is chosen to accommodate high-altitude contacts at the fringe of BEAST
    // range where inter-fix gaps of 35–50 s are common but do not represent a
    // true tracking loss (the aircraft is still in range, just intermittently decoded).
    const MAX_TRAIL_GAP_SEC = 60
    let segmentStart = 0
    for (let i = 1; i < entity.trail_pts.length; i++) {
      if (entity.trail_pts[i][3] - entity.trail_pts[i - 1][3] > MAX_TRAIL_GAP_SEC) {
        segmentStart = i
      }
    }
    const continuousTrail = serverTrail.slice(segmentStart)

    // Merge: adopt server trail when it is at least as dense as what we have.
    if (!existing?.trail || continuousTrail.length >= existing.trail.length) {
      trail = continuousTrail.slice(-TRAIL_CAP)
    } else {
      trail = existing.trail
    }
  } else {
    // Fallback: client-side accumulation (non-BEAST sources, or startup).
    const newPt: TrailPt = [entity.lon, entity.lat, altMeters, speedMs, entity.last_seen]
    trail = [...(existing?.trail ?? []), newPt].slice(-TRAIL_CAP)
  }

  const smoothedTrail = trail.length >= 2
    ? chaikinSmooth(filterTrailSpikes(trail.map(p => [p[0], p[1]])), 2)
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
    category:     (entity.identity?.category as string | undefined) ?? entity.tags?.[0],
    trail,
    smoothedTrail,
    predictedPath,
  }
}

function mergeEntityState(previous: Entity | undefined, incoming: Entity): Entity {
  if (!previous) return incoming
  if (incoming.entity_type !== 'aircraft') return incoming

  return {
    ...previous,
    ...incoming,
    // Keep cached enrichment keys between BEAST frame updates.
    identity: {
      ...(previous.identity ?? {}),
      ...(incoming.identity ?? {}),
    },
    tags: incoming.tags ?? previous.tags,
    distance_km: incoming.distance_km ?? previous.distance_km,
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

const defaultSummary: SummaryState = {
  summary: '',
  ts: null,
  model: null,
}

export const useCivicStore = create<CivicStore>((set) => ({
  // Data
  entities:         {},
  tracks:           {},
  alerts:           [],
  news:             [],
  systemEvents:     [],
  weather:          defaultWeather,
  radio:            emptyRadio,
  cameras:          [],
  trafficFlow:      [],
  trafficIncidents: [],
  utilityStatus:    null,
  oregonStatus:     null,
  trail:            [],
  airports:         {},
  summary:          defaultSummary,

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
  camerasVisible:   false,
  geofencesVisible: true,
  selectedCamId:    null,
  favoriteCamIds:   loadFavoriteCamIds(),
  mobileNavOpen:    false,
  settingsOpen:     false,
  entityFilter:     { aircraft: true, vessel: true, mesh_node: true },
  entitySearchQuery: '',
  entityAltRange:   ALT_RANGE_DEFAULT,
  entitySpeedRange: SPD_RANGE_DEFAULT,

  // Geofence draw
  geofenceDrawing:      false,
  geofenceDrawPoints:   [],

  // Replay
  replayMode:      false,
  replayData:      null,
  replayCurrentTs: 0,
  replayPlaying:   false,
  replaySpeed:     1,

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
  setAircraftSnapshot: (list) =>
    set((s) => {
      const nextEntities: Record<string, Entity> = {}
      const nextTracks: Record<string, Track> = {}

      // Preserve non-aircraft state as-is.
      for (const [id, entity] of Object.entries(s.entities)) {
        if (entity.entity_type !== 'aircraft') {
          nextEntities[id] = entity
        }
      }
      for (const [id, track] of Object.entries(s.tracks)) {
        if (track.type !== 'air') {
          nextTracks[id] = track
        }
      }

      // Replace aircraft subset, but preserve prior trail history for matching IDs.
      for (const entity of list) {
        nextEntities[entity.entity_id] = entity
        const track = entityToTrack(entity, s.tracks[entity.entity_id])
        if (track) nextTracks[entity.entity_id] = track
      }

      return { entities: nextEntities, tracks: nextTracks }
    }),
  upsertEntity: (entity) =>
    set((s) => {
      const merged = mergeEntityState(s.entities[entity.entity_id], entity)
      const track = entityToTrack(merged, s.tracks[entity.entity_id])
      return {
        entities: { ...s.entities, [entity.entity_id]: merged },
        tracks: track ? { ...s.tracks, [entity.entity_id]: track } : s.tracks,
      }
    }),
  purgeStaleEntities: () =>
    set((s) => {
      const now = Date.now()
      const next = { ...s.entities }
      let changed = false
      const STALE_MS: Record<string, number> = {
        aircraft:  60_000,        // 1 min  — ADS-B updates every 5 s
        vessel:    600_000,       // 10 min — AIS updates are infrequent
        mesh_node: 3_600_000,     // 1 hour — nodes are semi-static
      }
      for (const [id, e] of Object.entries(next)) {
        const limit = STALE_MS[e.entity_type]
        if (limit && e.last_seen) {
          const age = now - new Date(e.last_seen).getTime()
          if (age > limit) {
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
  appendSystemEvent: (event) =>
    set((s) => {
      const existing = s.systemEvents.find((ev) => ev.event_id === event.event_id)
      if (existing) {
        const updated = s.systemEvents.map((ev) => (ev.event_id === event.event_id ? event : ev))
        return { systemEvents: updated.slice(-100) }
      }
      return { systemEvents: [...s.systemEvents, event].slice(-100) }
    }),
  setSystemEvents: (events) =>
    set(() => {
      const deduped = new Map<string, SystemEvent>()
      for (const event of events) deduped.set(event.event_id, event)
      return { systemEvents: Array.from(deduped.values()).slice(-100) }
    }),
  setAlerts:    (alerts)  => set({ alerts }),
  setNews:      (news)    => set({ news }),
  setWeather:   (patch)   => set((s) => ({ weather: { ...s.weather, ...patch } })),
  setRadio:     (radio)   => set({ radio }),
  setCameras:   (cameras) => set({ cameras }),
  setTrafficFlow: (trafficFlow) => set({ trafficFlow }),
  setTrafficIncidents: (trafficIncidents) => set({ trafficIncidents }),
  setUtilityStatus: (utilityStatus) => set({ utilityStatus }),
  setOregonStatus: (oregonStatus) => set({ oregonStatus }),
  setTrail:     (trail)   => set({ trail }),
  setAirports:  (airports) => set({ airports }),
  setSummary:   (patch)   => set((s) => ({ summary: { ...s.summary, ...patch } })),

  // Connection actions
  setConnected: (connected) => set({ connected }),
  setHealth:    (patch) =>
    set((s) => ({ health: { ...s.health, ...patch } })),

  // UI actions
  setMode:           (mode)           => set({ mode }),
  setActiveTab:      (activeTab)      => set({ activeTab }),
  selectEntity:      (selectedEntityId) => set({ selectedEntityId }),
  setLdiMode:        (ldiMode)        => set({ ldiMode }),
  setRadarVisible:   (radarVisible)   => set({ radarVisible }),
  setRadarOpacity:   (radarOpacity)   => set({ radarOpacity }),
  setCamerasVisible: (camerasVisible) => set({ camerasVisible }),
  setGeofencesVisible: (geofencesVisible) => set({ geofencesVisible }),
  setMobileNavOpen:  (mobileNavOpen)  => set({ mobileNavOpen }),
  setSettingsOpen:   (settingsOpen)   => set({ settingsOpen }),
  setEntityFilter:   (f)              => set((s) => ({ entityFilter: { ...s.entityFilter, ...f } })),
  setEntitySearchQuery: (entitySearchQuery) => set({ entitySearchQuery }),
  setEntityAltRange:   (entityAltRange)    => set({ entityAltRange }),
  setEntitySpeedRange: (entitySpeedRange)  => set({ entitySpeedRange }),

  setGeofenceDrawing:   (geofenceDrawing) => set({ geofenceDrawing }),
  addGeofenceDrawPoint: (pt) => set((s) => ({ geofenceDrawPoints: [...s.geofenceDrawPoints, pt] })),
  clearGeofenceDrawPoints: () => set({ geofenceDrawPoints: [] }),

  setReplayMode:      (replayMode)      => set({ replayMode }),
  setReplayData:      (replayData)      => set({ replayData }),
  setReplayCurrentTs: (replayCurrentTs) => set({ replayCurrentTs }),
  setReplayPlaying:   (replayPlaying)   => set({ replayPlaying }),
  setReplaySpeed:     (replaySpeed)     => set({ replaySpeed }),
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
