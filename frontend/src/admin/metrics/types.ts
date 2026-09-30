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
  uptime_seconds?: number
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
  oldest_observation_at: string | null
  oldest_age_days: number | null
  last_purge: { ts: number; deleted: number; acars_deleted?: number; retention_days?: number } | null
  health: { status: 'ok' | 'degraded' | 'critical'; message: string; oldest_age_days: number | null; last_purge_age_hours: number | null } | null
  steady_state: { rows: number; bytes: number } | null
  table_sizes: { name: string; bytes: number }[]
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
  max_overflow: number
  checked_in: number
  checked_out: number
  overflow: number
  invalid: number
  capacity: number
  utilization: number
  level: 'ok' | 'warn' | 'critical'
  message: string | null
  overflow_in_use: number
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

export type EntityActivityEntry = {
  entity_type: string
  label?: string           // display name for non-entity rows (radio calls, dispatch incidents)
  group?: 'dispatch'
  active_window_min?: number
  extra?: {
    transcribed_pct?: number | null
    avg_duration_s?: number | null
    located_pct?: number | null
    life_safety?: number
    categories?: [string, number][]
  }
  active_now: number       // seen in the last `active_window_min`
  seen_24h: number
  dormant: number          // in the registry but not seen in 24 h (the entity table is never pruned)
  registry_total: number
  hourly: number[]         // distinct entities seen per hour, oldest first, 24 values
  peak_hour: number
  newest_age_s: number | null
  continuous: boolean      // expected to update all the time
  live: boolean | null     // for continuous types: the newest sighting is recent enough
  live_window_min: number | null
}

export type EntityActivityData = {
  types: EntityActivityEntry[]
  active_window_min: number
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

export type OverviewIssue = {
  severity: 'critical' | 'warning' | 'info'
  area: string
  title: string
  detail: string
  tab: 'system' | 'ingestion' | 'quality' | 'storage' | 'events'
}

export type FeedRow = {
  key: string
  label: string
  group: string
  age_s: number
  max_age_s: number | null
  status: 'ok' | 'stale' | 'down' | 'on_change'
  items: number | null
}

export type OverviewData = {
  status: 'ok' | 'warning' | 'critical'
  issues: OverviewIssue[]
  checked_at: number
  services: {
    postgres: { ping_ms: number | null; size_bytes?: number; connections?: number; max_connections?: number }
    redis: { ping_ms: number | null; used_memory_bytes?: number; max_memory_bytes?: number; clients?: number; keys?: number }
    api: { req_rate: number; error_pct: number; p95_ms: number; memory_mb: number; cpu_pct: number; ws_clients: number; uptime_seconds?: number } | null
    pollers: { total: number; ok: number; stale: number; error: number; unknown: number; slowest: { name: string; staleness_s: number } | null }
    briefing: { age_s: number; posture: string | null; model: string | null; duration_s: number | null } | null
    receiver: { beast_connected: boolean | null; beast_healthy: boolean | null; last_frame_age_s: number | null; count: number | null; positioned: number | null; frames_dropped: number | null } | null
  }
  feeds: FeedRow[]
}

export type EventActivityEntry = {
  event_type: string
  total: number
  last_24h: number
  last_hour: number
  hourly: number[]
}

export type EventActivityData = {
  types: EventActivityEntry[]
  total: number
  last_24h: number
}
