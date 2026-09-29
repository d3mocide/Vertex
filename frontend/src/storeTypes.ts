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
  distance_km?:    number
  signal_quality?: number
  status?:         string
  last_seen?:   string
  // Position freshness (BEAST decoder / normalizers):
  // stale = last real fix is older than the stale threshold;
  // dr = lat/lon are dead-reckoned forward from that fix server-side.
  position_stale?: boolean
  position_dr?:    boolean
  position_age_s?: number | null
  position_ts?:    number | null   // epoch seconds of the position fix (server clock)
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

// ─── Feed freshness (backend /health/feeds + WebSocket feed_update.ts) ───────
export interface FeedMetaEntry {
  ts: string                 // ISO time the poller last produced/confirmed this feed
  max_age_s?: number | null  // age after which the feed counts as stale
}

// ─── Radio-derived incidents (poller radio_incidents.py) ─────────────────────
export type RadioIncidentCategory =
  | 'water_rescue' | 'structure_fire' | 'violence' | 'rescue' | 'hazmat' | 'gas_leak'
  | 'carbon_monoxide' | 'train_or_ped_struck' | 'crash' | 'vehicle_fire' | 'outside_fire'
  | 'fire' | 'assault' | 'fire_alarm' | 'medical' | 'other'

export interface RadioIncident {
  id: string
  category: RadioIncidentCategory
  severity: number             // 1 routine … 5 life safety
  location: string | null      // corrected street name when ASR garbled it
  location_heard: string | null
  first_seen: string
  last_seen: string
  call_count: number
  units: string[]
  status: 'active' | 'on_scene' | 'contained' | 'cleared'
  acuity: string | null        // MPDS level (alpha … echo)
  talkgroups: string[]
  quote: string
  lat: number | null
  lon: number | null
  geofences: string[]          // "<name> (<zone_type>)"
  dist_km?: number | null      // from home (REGION_LAT/LON)
  // Deterministic enrichment (poller radio_incidents.py / geocoder)
  city?: string | null         // from the map: dispatch names the street, not the city
  cross_streets?: string | null
  nature?: string | null       // "Commercial fire" when dispatch says so
  unit_summary?: string | null // "2 engines, a heavy rescue, an ambulance"
  markers?: string[]           // "Entrapment", "Evacuation", "More resources requested", …
}

export interface RadioIncidentFeed {
  ts: string | null
  window_hours: number | null
  /** Radius the advisory bar and sidebar treat as "nearby". */
  nearby_km?: number
  incident_count: number
  located_count: number
  transcribed_calls: number
  by_category: Record<string, number>
  incidents: RadioIncident[]
}

/** One ranked item for the advisory bar (poller/advisories.py). */
export interface Advisory {
  id: string
  source: 'nws' | 'radio' | 'traffic' | 'flashalert' | 'briefing'
  level: 'red' | 'amber'
  score: number
  title: string
  detail: string
  ts: string | null
  why: string
  lat?: number | null
  lon?: number | null
  target: { tab: string; incident?: string }
}

export interface AdvisoryFeed {
  ts: string | null
  level: 'green' | 'amber' | 'red'
  count: number
  items: Advisory[]
}

export type SummaryPosture = 'NORMAL' | 'ELEVATED' | 'HIGH'

export interface SummaryState {
  summary: string
  ts: string | null
  model: string | null
  posture: SummaryPosture | null
  windowHours: number | null
  dataGaps: string[]
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
  source:        string
  lastSeen?:     string
  positionStale?: boolean
  positionDr?:    boolean      // position is a server-side dead-reckoned estimate
  fixTimeMs?:     number       // local wall-clock time the position was measured
  lat:           number
  lon:           number
  altMeters:     number        // metres MSL (0 for vessels)
  speedMs:       number        // m/s
  courseTrue:    number        // 0–360°, true north
  type:          'air' | 'sea' | 'ground' | 'hazard' | 'tak' | 'rail' | 'sensor'
  callsign?:     string
  category?:     string
  stationType?:  string
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
  // Ranked stories (poller news_rank.py); absent on reference links.
  id?:        string
  topic?:     string
  /** 3 home area · 2 metro · 1 Oregon · 0 elsewhere */
  local?:     number
  emergency?: boolean
  score?:     number
  /** Every outlet that ran the story (duplicates are merged). */
  sources?:   { source: string; link: string }[]
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
  wind_gust_mph?: number | null
  wind_dir?:   string
  condition?:  string
  humidity?:   number
  aqi?:        number
  aqi_label?:  string
  alerts:      WeatherAlert[]
}

// ─── Radio ────────────────────────────────────────────────────────────────────
export interface RadioState {
  tgid:     number | null
  tag:      string | null
  freq_hz:  number | null
  state:    'idle' | 'call' | 'encrypted' | null
  updated:  string | null
  priority?: number | null
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
  details?:   {
    lat?: number
    lon?: number
    magnitude?: number
    depth_km?: number
    [key: string]: unknown
  }
}

// ─── Mesh Networking ─────────────────────────────────────────────────────────
export interface MeshMessage {
  id:               string
  msg_type?:        string
  conversation_key: string
  channel_name?:    string
  text:             string
  sender_name:      string
  sender_key:       string
  outgoing:         boolean
  acked:            boolean
  timestamp:        string
  source_url:       string
}

export interface MeshLink {
  source_url:       string
  node_a:           string
  node_b:           string
  snr:              number | null
  link_quality:     number | null
  last_seen:        string
}

// ─── Traffic / Utility ────────────────────────────────────────────────────────
export interface TrafficFlowSensor {
  road?: string
  loc?: string
  speed?: number
  [key: string]: unknown
}

export interface UtilityStatus {
  status: string
  active_outages: number
  customers_affected: number
  last_updated: string
  [key: string]: unknown
}

export interface OregonStatus {
  status: string
  state_affected: number
  metro_affected: number
  pge_affected: number
  pacificorp_affected: number
  last_updated: string
  [key: string]: unknown
}

// ─── Map Annotations ─────────────────────────────────────────────────────────
export interface AnnotationItem {
  id: number
  annotation_type: 'marker' | 'line' | 'polygon'
  label: string | null
  color: string
  geojson: object
  created_by: string | null
  expires_at: string | null
  created_at: string
  tak_uid: string | null
}

// ─── Entity Mission Tags (operator-assigned labels) ──────────────────────────
export interface EntityMissionTag {
  id: number
  entity_id: string
  tag: string
  color: string
  created_by: string | null
  created_at: string
}

// ─── Custom Layers (KML / GeoJSON import) ────────────────────────────────────
export interface CustomLayerItem {
  id: number
  name: string
  geojson: object
  style: { color?: string; opacity?: number; line_color?: string; line_width?: number } | null
  visible: boolean
  created_at: string
}

// ─── System Health ────────────────────────────────────────────────────────────
export interface SystemHealth {
  ok:       boolean
  redis:    boolean
  services: Record<string, 'up' | 'down' | 'degraded'>
}

// ─── UI State ─────────────────────────────────────────────────────────────────
export type AppMode  = 'calm' | 'critical'
export type NavTab   = 'safety' | 'infrastructure' | 'environment' | 'intel' | 'events' | 'incidents' | 'comms' | 'flightlog'
export type EntityTypeFilter = {
  aircraft: boolean
  adsbLocal: boolean
  adsbSupplement: boolean
  vessel: boolean
  mesh_node: boolean
  aprs: boolean
  fire_incident: boolean
  satellite: boolean
  rf_sensor: boolean
  train: boolean
}

// [min, max] — altitude in feet, speed in knots
export type RangeFilter = [number, number]

export const ALT_RANGE_DEFAULT: RangeFilter  = [0, 60_000]
export const SPD_RANGE_DEFAULT: RangeFilter  = [0, 600]

// ─── ACARS ───────────────────────────────────────────────────────────────────
export interface AcarsMessage {
  id?:         number
  tail:        string
  flight:      string
  freq:        string
  label:       string
  msg_num:     string
  msg_text:    string
  station_id:  string
  error:       number
  mode:        string
  ts:          string
}

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
  bucket_s?:  number    // server thinned points to one per bucket per entity
  truncated?: boolean   // hit the server's point cap
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
