import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { entityToTrack, mergeEntityState, loadFavoriteCamIds } from './entityUtils'

// Re-export all types so existing imports from '../../store' keep working.
export * from './storeTypes'
import type {
  Entity, Track, AlertItem, NewsItem, WeatherState, RadioState,
  TrafficCamera, SystemEvent, CustomLayerItem, SystemHealth, TrafficIncident,
  SummaryState, TrailPoint, AirportSnapshot, AppMode, NavTab, EntityTypeFilter,
  RangeFilter, ReplayData, EntityMissionTag, AnnotationItem,
  TrafficFlowSensor, UtilityStatus, OregonStatus, MeshMessage, MeshLink,
  AcarsMessage,
} from './storeTypes'
import { ALT_RANGE_DEFAULT, SPD_RANGE_DEFAULT } from './storeTypes'

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
  trafficFlow:      TrafficFlowSensor[]
  trafficIncidents: TrafficIncident[]
  utilityStatus:    UtilityStatus | null
  oregonStatus:     OregonStatus | null
  trail:            TrailPoint[]
  airports:         Record<string, AirportSnapshot>
  summary:          SummaryState
  meshMessages:     MeshMessage[]
  meshLinks:        MeshLink[]
  meshStatus:       any | null
  linkHistory:      Record<string, { snr: number[], quality: number[] }>

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
  trailsVisible:    boolean
  radarReflectivityVisible: boolean
  nwsAlertsVisible:         boolean
  lightningDensityVisible:  boolean
  railTracksVisible:        boolean

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
  setTrafficFlow:   (flow: TrafficFlowSensor[]) => void
  setTrafficIncidents: (incidents: TrafficIncident[]) => void
  setUtilityStatus: (status: UtilityStatus) => void
  setOregonStatus:  (status: OregonStatus) => void
  setTrail:         (trail: TrailPoint[]) => void
  refreshEntityTrack: (entityId: string) => void
  setAirports:      (airports: Record<string, AirportSnapshot>) => void
  setSummary:       (summary: Partial<SummaryState>) => void
  appendMeshMessage: (msg: MeshMessage) => void
  setMeshMessages:   (msgs: MeshMessage[]) => void
  setMeshLinks:     (links: MeshLink[]) => void
  setMeshStatus:    (status: any) => void
  updateLinkHistory: (links: MeshLink[]) => void

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
  smokeVisible:        boolean
  setSmokeVisible:     (v: boolean) => void
  goesVisible:         boolean
  setGoesVisible:      (v: boolean) => void
  firePerimetersVisible: boolean
  setFirePerimetersVisible: (v: boolean) => void
  setCamerasVisible:   (v: boolean) => void
  setGeofencesVisible: (v: boolean) => void
  setTrailsVisible:    (v: boolean) => void
  setRadarReflectivityVisible: (v: boolean) => void
  setNwsAlertsVisible:         (v: boolean) => void
  setLightningDensityVisible:  (v: boolean) => void
  setRailTracksVisible:        (v: boolean) => void
  mobileNavOpen:       boolean
  setMobileNavOpen:    (v: boolean) => void
  settingsOpen:        boolean
  setSettingsOpen:     (v: boolean) => void
  helpOpen:            boolean
  setHelpOpen:         (v: boolean) => void
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
  geofenceDrawMode:     'polygon' | 'circle'
  geofenceDrawPoints:   [number, number][]   // [lon, lat] pairs
  setGeofenceDrawing:   (v: boolean) => void
  setGeofenceDrawMode:  (v: 'polygon' | 'circle') => void
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

  // Custom layers (KML / GeoJSON import)
  customLayers:     CustomLayerItem[]
  setCustomLayers:  (layers: CustomLayerItem[]) => void

  // Entity mission tags
  entityMissionTags:       Record<string, EntityMissionTag[]>
  setEntityMissionTags:    (entityId: string, tags: EntityMissionTag[]) => void
  addEntityMissionTag:     (tag: EntityMissionTag) => void
  removeEntityMissionTag:  (entityId: string, tagId: number) => void

  // Map annotations
  annotations:             AnnotationItem[]
  setAnnotations:          (items: AnnotationItem[]) => void
  addAnnotation:           (item: AnnotationItem) => void
  updateAnnotation:        (item: AnnotationItem) => void
  removeAnnotation:        (id: number) => void
  annotationDrawMode:      'marker' | 'line' | 'polygon' | null
  setAnnotationDrawMode:   (mode: 'marker' | 'line' | 'polygon' | null) => void
  annotationDrawPoints:    [number, number][]
  annotationDrawCursor:    [number, number] | null
  setAnnotationDrawPreview: (points: [number, number][], cursor: [number, number] | null) => void
  clearAnnotationDrawPreview: () => void
  annotationsVisible:      boolean
  setAnnotationsVisible:   (v: boolean) => void
  annotationToolbarOpen:   boolean
  setAnnotationToolbarOpen: (v: boolean) => void

  // ACARS messages (rolling buffer, newest-first, capped at 500)
  acarsMessages:        AcarsMessage[]
  appendAcarsMessage:   (msg: AcarsMessage) => void
  setAcarsMessages:     (msgs: AcarsMessage[]) => void

  // Lightning strikes (rolling 60-second buffer, fed from Blitzortung via WS)
  lightningStrikes:       LightningStrike[]
  appendLightningStrikes: (strikes: LightningStrike[]) => void
  lightningVisible:       boolean
  setLightningVisible:    (v: boolean) => void

  // Stream gauges visibility
  gaugesVisible:       boolean
  setGaugesVisible:    (v: boolean) => void

  // 3-D terrain
  terrainEnabled:         boolean
  setTerrainEnabled:      (v: boolean) => void
  terrainExaggeration:    number
  setTerrainExaggeration: (v: number) => void
}

export interface LightningStrike {
  lat: number
  lon: number
  ts:  number   // unix ms
}

const LIGHTNING_MAX_POINTS = 1000
const LIGHTNING_WINDOW_MS = 60_000
const LIGHTNING_FUTURE_SKEW_MS = 5_000

function normalizeLightningTs(rawTs: unknown): number | null {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    // Accept seconds, milliseconds, or nanoseconds and normalize to ms.
    if (rawTs > 1e15) return Math.floor(rawTs / 1_000_000)
    if (rawTs > 1e11) return Math.floor(rawTs)
    if (rawTs > 1e9) return Math.floor(rawTs * 1000)
    return null
  }

  if (typeof rawTs === 'string') {
    const parsed = Date.parse(rawTs)
    if (!Number.isNaN(parsed)) return parsed
  }

  return null
}

function normalizeIncomingLightning(
  incoming: LightningStrike[],
  nowMs: number,
): LightningStrike[] {
  const minTs = nowMs - LIGHTNING_WINDOW_MS
  const maxTs = nowMs + LIGHTNING_FUTURE_SKEW_MS
  const out: LightningStrike[] = []

  for (const strike of incoming) {
    const lat = Number(strike?.lat)
    const lon = Number(strike?.lon)
    const ts = normalizeLightningTs(strike?.ts)

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || ts === null) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    if (ts < minTs || ts > maxTs) continue

    out.push({ lat, lon, ts })
  }

  return out
}

const MESH_MESSAGES_MAX = 300

function meshMsgTime(msg: MeshMessage): number {
  if (!msg?.timestamp) return 0
  const ts = Date.parse(msg.timestamp)
  return Number.isNaN(ts) ? 0 : ts
}

function meshMsgFingerprint(msg: MeshMessage): string {
  if (msg?.id) return `id:${msg.id}`
  const sender = msg?.sender_key ?? msg?.sender_name ?? 'unknown'
  const text = msg?.text ?? ''
  const conv = msg?.conversation_key ?? 'public'
  const ts = msg?.timestamp ?? ''
  return `fp:${conv}|${sender}|${ts}|${text}`
}

function mergeMeshMessages(existing: MeshMessage[], incoming: MeshMessage[]): MeshMessage[] {
  const byKey = new Map<string, MeshMessage>()

  for (const msg of existing) {
    byKey.set(meshMsgFingerprint(msg), msg)
  }
  for (const msg of incoming) {
    byKey.set(meshMsgFingerprint(msg), msg)
  }

  return Array.from(byKey.values())
    .sort((a, b) => meshMsgTime(a) - meshMsgTime(b))
    .slice(-MESH_MESSAGES_MAX)
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

export const useCivicStore = create<CivicStore>()(
  persist(
    (set) => ({
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
  meshMessages:     [],
  meshLinks:        [],
  meshStatus:       null,
  linkHistory:      {},
  acarsMessages:    [],

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
  smokeVisible:           false,
  goesVisible:            false,
  firePerimetersVisible:  false,
  camerasVisible:         false,
  geofencesVisible:    true,
  trailsVisible:       true,
  radarReflectivityVisible: false,
  nwsAlertsVisible:         false,
  lightningDensityVisible:  false,
  railTracksVisible:        true,
  lightningStrikes:    [],
  lightningVisible:    true,
  gaugesVisible:       true,
  terrainEnabled:      false,
  terrainExaggeration: 1.5,
  selectedCamId:    null,
  favoriteCamIds:   loadFavoriteCamIds(),
  customLayers:     [],
  entityMissionTags: {},
  annotations:      [],
  annotationDrawMode: null,
  annotationDrawPoints: [],
  annotationDrawCursor: null,
  annotationsVisible: true,
  annotationToolbarOpen: false,
  mobileNavOpen:    false,
  settingsOpen:     false,
  helpOpen:         false,
  entityFilter:     { aircraft: true, adsbLocal: true, adsbSupplement: true, vessel: true, mesh_node: true, aprs: true, fire_incident: true, satellite: true, tinygs_station: true, train: true },
  entitySearchQuery: '',
  entityAltRange:   ALT_RANGE_DEFAULT,
  entitySpeedRange: SPD_RANGE_DEFAULT,

  // Geofence draw
  geofenceDrawing:      false,
  geofenceDrawMode:     'polygon',
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

      // Preserve existing aircraft (both local and opensky) that are not in the incoming list,
      // provided they have not gone stale based on their last_seen.
      for (const [id, entity] of Object.entries(s.entities)) {
        if (entity.entity_type === 'aircraft') {
          const isOpensky = (entity.source ?? '').toLowerCase() === 'opensky'
          const limit = isOpensky ? 600_000 : 120_000
          if (entity.last_seen) {
            const age = Date.now() - new Date(entity.last_seen).getTime()
            if (age <= limit) {
              nextEntities[id] = entity
              const track = s.tracks[id]
              if (track && track.type === 'air') nextTracks[id] = track
            }
          }
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
        aircraft:       120_000,   // 2 min  — Matches backend stale cutoff
        vessel:         600_000,   // 10 min — AIS updates are infrequent
        mesh_node:    604_800_000, // 7 days — mesh nodes are semi-permanent infrastructure
        satellite:    1_800_000,   // 30 min — matches poller TTL
        tinygs_station: 600_000,   // 10 min — station ping is every ~60 s
        stream_gauge:   600_000,   // 10 min — gauges are polled every 5 min
        tak_client:     300_000,   // 5 min  — TAK SA ping is every 30 s–2 min
        train:          600_000,   // 10 min — Amtrak polls every 60 s
      }
      for (const [id, e] of Object.entries(next)) {
        let limit = STALE_MS[e.entity_type]
        if (e.entity_type === 'aircraft' && (e.source ?? '').toLowerCase() === 'opensky') {
          limit = 600_000 // 10 min threshold for OpenSky (polls every 4 min)
        }
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
  refreshEntityTrack: (entityId) =>
    set((s) => {
      const entity = s.entities[entityId]
      if (!entity) return {}
      const existing = s.tracks[entityId]
      const track = entityToTrack(entity, existing)
      if (!track) return {}
      return { tracks: { ...s.tracks, [entityId]: track } }
    }),
  setAirports:  (airports) => set({ airports }),
  setSummary:   (patch)   => set((s) => ({ summary: { ...s.summary, ...patch } })),
  appendMeshMessage: (msg) => set(s => {
    return { meshMessages: mergeMeshMessages(s.meshMessages, [msg]) }
  }),
  setMeshMessages: (msgs) => set((s) => ({ meshMessages: mergeMeshMessages(s.meshMessages, msgs) })),
  setMeshLinks: (links) => set({ meshLinks: links }),
  setMeshStatus: (status) => set({ meshStatus: status }),
  updateLinkHistory: (links) => set(state => {
    const next = { ...state.linkHistory }
    links.forEach(l => {
      const key = `${l.node_a}-${l.node_b}`
      if (!next[key]) next[key] = { snr: [], quality: [] }
      next[key].snr = [...next[key].snr, l.snr || 0].slice(-20)
      next[key].quality = [...next[key].quality, l.link_quality || 0].slice(-20)
    })
    return { linkHistory: next, meshLinks: links }
  }),

  appendAcarsMessage: (msg) =>
    set((s) => ({
      acarsMessages: [msg, ...s.acarsMessages].slice(0, 500),
    })),
  setAcarsMessages: (msgs) => set({ acarsMessages: msgs }),

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
  setSmokeVisible:          (smokeVisible)          => set({ smokeVisible }),
  setGoesVisible:           (goesVisible)           => set({ goesVisible }),
  setFirePerimetersVisible: (firePerimetersVisible) => set({ firePerimetersVisible }),
  setCamerasVisible:        (camerasVisible)        => set({ camerasVisible }),
  setGeofencesVisible: (geofencesVisible) => set({ geofencesVisible }),
  setTrailsVisible:    (trailsVisible)    => set({ trailsVisible }),
  setRadarReflectivityVisible: (radarReflectivityVisible) => set({ radarReflectivityVisible }),
  setNwsAlertsVisible:         (nwsAlertsVisible)         => set({ nwsAlertsVisible }),
  setLightningDensityVisible:  (lightningDensityVisible)  => set({ lightningDensityVisible }),
  setRailTracksVisible:        (railTracksVisible)        => set({ railTracksVisible }),
  appendLightningStrikes: (incoming) =>
    set((s) => {
      const now = Date.now()
      const minTs = now - LIGHTNING_WINDOW_MS
      const fresh = s.lightningStrikes.filter((strike) => strike.ts >= minTs)
      const normalizedIncoming = normalizeIncomingLightning(incoming, now)

      if (normalizedIncoming.length === 0) {
        return { lightningStrikes: fresh.slice(-LIGHTNING_MAX_POINTS) }
      }

      return {
        lightningStrikes: [...fresh, ...normalizedIncoming].slice(-LIGHTNING_MAX_POINTS),
      }
    }),
  setLightningVisible:    (lightningVisible)    => set({ lightningVisible }),
  setGaugesVisible:       (gaugesVisible)       => set({ gaugesVisible }),
  setTerrainEnabled:      (terrainEnabled)      => set({ terrainEnabled }),
  setTerrainExaggeration: (terrainExaggeration) => set({ terrainExaggeration }),
  setMobileNavOpen:  (mobileNavOpen)  => set({ mobileNavOpen }),
  setSettingsOpen:   (settingsOpen)   => set({ settingsOpen }),
  setHelpOpen:       (helpOpen)       => set({ helpOpen }),
  setEntityFilter:   (f)              => set((s) => ({ entityFilter: { ...s.entityFilter, ...f } })),
  setEntitySearchQuery: (entitySearchQuery) => set({ entitySearchQuery }),
  setEntityAltRange:   (entityAltRange)    => set({ entityAltRange }),
  setEntitySpeedRange: (entitySpeedRange)  => set({ entitySpeedRange }),

  setGeofenceDrawing:   (geofenceDrawing) => set({ geofenceDrawing }),
  setGeofenceDrawMode:  (geofenceDrawMode) => set({ geofenceDrawMode }),
  addGeofenceDrawPoint: (pt) =>
    set((s) => {
      if (s.geofenceDrawMode !== 'circle') {
        return { geofenceDrawPoints: [...s.geofenceDrawPoints, pt] }
      }
      if (s.geofenceDrawPoints.length === 0) {
        return { geofenceDrawPoints: [pt] }
      }
      if (s.geofenceDrawPoints.length === 1) {
        return { geofenceDrawPoints: [s.geofenceDrawPoints[0], pt] }
      }
      return { geofenceDrawPoints: [s.geofenceDrawPoints[0], pt] }
    }),
  clearGeofenceDrawPoints: () => set({ geofenceDrawPoints: [] }),

  setReplayMode:      (replayMode)      => set({ replayMode }),
  setReplayData:      (replayData)      => set({ replayData }),
  setReplayCurrentTs: (replayCurrentTs) => set({ replayCurrentTs }),
  setReplayPlaying:   (replayPlaying)   => set({ replayPlaying }),
  setReplaySpeed:     (replaySpeed)     => set({ replaySpeed }),
  setSelectedCamId: (selectedCamId) => set({ selectedCamId }),
  setCustomLayers: (customLayers) => set({ customLayers }),

  setEntityMissionTags: (entityId, tags) =>
    set((s) => ({ entityMissionTags: { ...s.entityMissionTags, [entityId]: tags } })),
  addEntityMissionTag: (tag) =>
    set((s) => {
      const existing = s.entityMissionTags[tag.entity_id] ?? []
      return { entityMissionTags: { ...s.entityMissionTags, [tag.entity_id]: [...existing, tag] } }
    }),
  removeEntityMissionTag: (entityId, tagId) =>
    set((s) => {
      const filtered = (s.entityMissionTags[entityId] ?? []).filter((t) => t.id !== tagId)
      return { entityMissionTags: { ...s.entityMissionTags, [entityId]: filtered } }
    }),

  setAnnotations:       (annotations) => set({ annotations }),
  addAnnotation:        (item) => set((s) => ({ annotations: [...s.annotations, item] })),
  updateAnnotation:     (item) => set((s) => ({ annotations: s.annotations.map((a) => a.id === item.id ? item : a) })),
  removeAnnotation:     (id) => set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  setAnnotationDrawMode: (annotationDrawMode) => set({ annotationDrawMode }),
  setAnnotationDrawPreview: (annotationDrawPoints, annotationDrawCursor) => set({ annotationDrawPoints, annotationDrawCursor }),
  clearAnnotationDrawPreview: () => set({ annotationDrawPoints: [], annotationDrawCursor: null }),
  setAnnotationsVisible: (annotationsVisible) => set({ annotationsVisible }),
  setAnnotationToolbarOpen: (annotationToolbarOpen) => set({ annotationToolbarOpen }),

  toggleFavoriteCam: (id) =>
    set((s) => {
      const next = s.favoriteCamIds.includes(id)
        ? s.favoriteCamIds.filter((f) => f !== id)
        : [...s.favoriteCamIds, id]
      localStorage.setItem('favoriteCamIds', JSON.stringify(next))
      return { favoriteCamIds: next }
    }),
  }),
  {
    name: 'vertex.ui.prefs',
    partialize: (state) => ({
      activeTab:          state.activeTab,
      mode:               state.mode,
      trailsVisible:      state.trailsVisible,
      radarVisible:       state.radarVisible,
      radarOpacity:       state.radarOpacity,
      smokeVisible:         state.smokeVisible,
      goesVisible:          state.goesVisible,
      firePerimetersVisible: state.firePerimetersVisible,
      camerasVisible:       state.camerasVisible,
      geofencesVisible:   state.geofencesVisible,
      annotationsVisible: state.annotationsVisible,
      lightningVisible:   state.lightningVisible,
      radarReflectivityVisible: state.radarReflectivityVisible,
      nwsAlertsVisible:         state.nwsAlertsVisible,
      lightningDensityVisible:  state.lightningDensityVisible,
      railTracksVisible:        state.railTracksVisible,
      gaugesVisible:      state.gaugesVisible,
      terrainEnabled:     state.terrainEnabled,
      terrainExaggeration: state.terrainExaggeration,
      ldiMode:            state.ldiMode,
    }),
  }
)
)
