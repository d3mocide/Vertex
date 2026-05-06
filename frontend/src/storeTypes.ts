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
  source:        string
  lat:           number
  lon:           number
  altMeters:     number        // metres MSL (0 for vessels)
  speedMs:       number        // m/s
  courseTrue:    number        // 0–360°, true north
  type:          'air' | 'sea' | 'ground' | 'hazard'
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
  details?:   {
    lat?: number
    lon?: number
    magnitude?: number
    depth_km?: number
    [key: string]: any
  }
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
export type NavTab   = 'safety' | 'infrastructure' | 'environment' | 'community' | 'events' | 'incidents'
export type EntityTypeFilter = {
  aircraft: boolean
  adsbLocal: boolean
  adsbSupplement: boolean
  vessel: boolean
  mesh_node: boolean
  aprs: boolean
  fire_incident: boolean
  satellite: boolean
  tinygs_station: boolean
}

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
