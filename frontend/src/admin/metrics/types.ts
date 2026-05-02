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
