export type HistoryPoint = {
  ts: number
  req_rate: number
  error_pct: number
  memory_mb: number
  p95_ms: number
  cpu_pct: number
  ws_clients: number
}

export type MetricsData = {
  available: boolean
  req_rate: number
  error_pct: number
  memory_mb: number
  cpu_pct: number
  p95_ms: number
  ws_clients: number
  db_ping_ms: number
  redis_ping_ms: number
  history: HistoryPoint[]
}

export type StorageData = {
  observation_count: number
  entity_count: number
  entity_type_counts: Record<string, number>
  retention_days: number
  table_size_bytes: number
  obs_per_day_7d: number
  event_count: number
  event_type_counts: Record<string, number>
}

export type PollerEntry = {
  name: string
  ts: number
  staleness_s: number
  status: 'ok' | 'stale' | 'error' | 'unknown'
  last_error: string | null
  obs_per_min: number
  error_count: number
}

export type IngestionBucket = {
  minute: string
  type: string
  count: number
}

export type DbPoolData = {
  pool_size: number
  checked_in: number
  checked_out: number
  overflow: number
  invalid: number
  error?: string
}

export type SignalQualityEntry = {
  entity_type: string
  avg_quality: number | null
  median_quality: number | null
  min_quality: number | null
  max_quality: number | null
  sample_count: number
}

export type SignalQualityData = {
  window_minutes: number
  types: SignalQualityEntry[]
}

export type FreshnessEntry = {
  entity_type: string
  total: number
  fresh_5m: number
  recent_15m: number
  stale_60m: number
  very_stale: number
}

export type EntityFreshnessData = {
  types: FreshnessEntry[]
}

export type SquawkAlertData = {
  window_hours: number
  squawk_7500: number
  squawk_7600: number
  squawk_7700: number
  total: number
}

export type TalkgroupBucket = {
  talkgroup_id: string
  label: string | null
  call_count: number
}

export type TalkgroupActivityData = {
  window_hours: number
  talkgroups: TalkgroupBucket[]
}

export type MeshBatteryNode = {
  entity_id: string
  label: string | null
  battery_level: number
}

export type MeshBatteryData = {
  nodes: MeshBatteryNode[]
}

export type DataQualityRow = {
  label: string
  entity_type: string
  field: string
  present: number
  total: number
  pct: number
}

export type DataQualityData = {
  rows: DataQualityRow[]
}
