import React from 'react'
import type { StorageData } from './types'

type Props = {
  storage: StorageData | null
  retentionDays: number
}

export function StorageSummary({ storage, retentionDays }: Props) {
  if (!storage) {
    return (
      <div className="border border-white/10 bg-black/30 p-4 stack-y-3">
        <h3 className="text-[11px] uppercase tracking-widest text-on-surface-variant">Storage Health</h3>
        <div className="text-on-surface-variant text-xs">Loading…</div>
      </div>
    )
  }

  // The backend judges purge health: at steady state the oldest observation sits at the retention age, which is
  // healthy. Trouble is data lingering well past retention, or a purge that stopped running.
  const health = storage.health
  const status = health?.status ?? 'ok'
  const statusColor = status === 'ok' ? '#4ADE80' : status === 'degraded' ? '#FCD34D' : '#FF5252'
  const statusLabel = status === 'ok' ? 'HEALTHY' : status === 'degraded' ? 'DEGRADED' : 'CRITICAL'

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
    return `${Math.round(bytes / 1024)} KB`
  }

  const oldest = storage.oldest_age_days
  const lastPurge = storage.last_purge
  const purgeHoursAgo = health?.last_purge_age_hours

  return (
    <section className="p-4 border border-white/10 bg-black/30 stack-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Overall Status */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-2">Storage Health</div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="font-mono text-[11px] font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Oldest data */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-2">Oldest Data</div>
          <div className="font-mono text-[14px] font-bold" style={{ color: statusColor }}>
            {oldest === null || oldest === undefined ? '—' : `${oldest.toFixed(1)}d`}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            of {retentionDays}d retention
          </div>
        </div>

        {/* Observations */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-2">Observations</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {storage.observation_count.toLocaleString()}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            {formatBytes(storage.table_size_bytes)}
          </div>
        </div>

        {/* Ingestion Rate */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-2">Obs / Day</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {Math.round(storage.obs_per_day_7d).toLocaleString()}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            7d average
          </div>
        </div>
      </div>

      {/* Purge status */}
      <div className={`flex gap-2 p-2 border text-xs ${
        status === 'ok' ? 'bg-black/20 border-white/10 text-on-surface-variant'
        : status === 'degraded' ? 'bg-amber-gold/10 border-amber-gold/40 text-amber-gold'
        : 'bg-red-emergency/10 border-red-emergency/40 text-red-emergency'}`}>
        <span className="ms text-[16px] shrink-0" aria-hidden="true">{status === 'ok' ? 'check_circle' : status === 'degraded' ? 'info' : 'error'}</span>
        <span>
          {health?.message ?? 'Purge status unavailable.'}{' '}
          {lastPurge
            ? `Last purge: ${purgeHoursAgo !== null && purgeHoursAgo !== undefined ? `${purgeHoursAgo < 1 ? 'under an hour' : `${Math.round(purgeHoursAgo)} h`} ago` : 'recorded'}, ${lastPurge.deleted.toLocaleString()} observations removed.`
            : 'No purge recorded yet (the first run after an update is recorded).'}
        </span>
      </div>
    </section>
  )
}
