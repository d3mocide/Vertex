import React from 'react'
import type { StorageData } from './types'

type Props = {
  storage: StorageData | null
  retentionDays: number
}

export function StorageSummary({ storage, retentionDays }: Props) {
  if (!storage) {
    return (
      <div className="border border-white/10 bg-black/30 p-4 space-y-3">
        <h3 className="text-[11px] uppercase tracking-widest text-gray-500">Storage Health</h3>
        <div className="text-gray-500 text-xs">Loading…</div>
      </div>
    )
  }

  // Calculate days until purge
  const daysUntilPurge = storage.obs_per_day_7d > 0
    ? Math.max(0, Math.round(retentionDays - (storage.observation_count / storage.obs_per_day_7d)))
    : retentionDays

  // Determine health status
  const isHealthy = daysUntilPurge > 7
  const isDegraded = daysUntilPurge >= 3 && daysUntilPurge <= 7
  const isPoor = daysUntilPurge < 3

  // Format bytes
  const formatBytes = (bytes: number): string => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
    return `${Math.round(bytes / 1024)} KB`
  }

  const statusColor = isHealthy ? '#4ADE80' : isDegraded ? '#FCD34D' : '#FF5252'
  const statusLabel = isHealthy ? 'HEALTHY' : isDegraded ? 'DEGRADED' : 'CRITICAL'

  return (
    <section className="p-4 border border-white/10 bg-black/30 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Overall Status */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Storage Health</div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="font-mono text-[11px] font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Days Until Purge */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Days Until Purge</div>
          <div className="font-mono text-[14px] font-bold" style={{ color: isPoor ? '#FF5252' : isDegraded ? '#FCD34D' : '#4ADE80' }}>
            {daysUntilPurge}d
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            of {retentionDays}d retention
          </div>
        </div>

        {/* Observations */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Observations</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {storage.observation_count.toLocaleString()}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            {formatBytes(storage.table_size_bytes)}
          </div>
        </div>

        {/* Ingestion Rate */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Obs / Day</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {Math.round(storage.obs_per_day_7d).toLocaleString()}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            7d average
          </div>
        </div>
      </div>

      {/* Status warnings */}
      {isDegraded && (
        <div className="flex gap-2 p-2 bg-amber-gold/10 border border-amber-gold/40 text-xs text-amber-gold">
          <span className="material-symbols text-sm shrink-0">info</span>
          <span>Approaching retention limit. Consider increasing retention or reducing ingestion.</span>
        </div>
      )}

      {isPoor && (
        <div className="flex gap-2 p-2 bg-red-emergency/10 border border-red-emergency/40 text-xs text-red-emergency">
          <span className="material-symbols text-sm shrink-0">error</span>
          <span>Critical: Data will purge in &lt;3 days. Increase retention immediately.</span>
        </div>
      )}
    </section>
  )
}
