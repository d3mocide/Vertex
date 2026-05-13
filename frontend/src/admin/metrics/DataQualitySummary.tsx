import React from 'react'
import type { DataQualityData, EntityFreshnessData } from './types'

type Props = {
  dataQuality: DataQualityData | null
  entityFreshness: EntityFreshnessData | null
}

export function DataQualitySummary({ dataQuality, entityFreshness }: Props) {
  if (!dataQuality || !entityFreshness) return null

  // Calculate overall health
  const avgCompleteness = dataQuality.rows.length > 0
    ? Math.round(dataQuality.rows.reduce((sum, r) => sum + r.pct, 0) / dataQuality.rows.length)
    : 0

  const totalEntities = entityFreshness.types.reduce((sum, t) => sum + t.total, 0)
  const freshEntities = entityFreshness.types.reduce((sum, t) => sum + t.fresh_5m, 0)
  const freshnessRate = totalEntities > 0 ? Math.round((freshEntities / totalEntities) * 100) : 0

  // Health status
  const isHealthy = avgCompleteness >= 80 && freshnessRate >= 70
  const isDegraded = avgCompleteness >= 50 && freshnessRate >= 30
  const statusColor = isHealthy ? '#4ADE80' : isDegraded ? '#FCD34D' : '#FB923C'
  const statusLabel = isHealthy ? 'HEALTHY' : isDegraded ? 'DEGRADED' : 'POOR'

  return (
    <section className="p-4 border border-white/10 bg-black/30 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Overall Status */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Overall Status</div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="font-mono text-[11px] font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Data Completeness */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Avg Completeness</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {avgCompleteness}%
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            {dataQuality.rows.length} field{dataQuality.rows.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Freshness Rate */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Fresh (&lt; 5min)</div>
          <div className="font-mono text-[14px] font-bold" style={{ color: freshnessRate >= 70 ? '#4ADE80' : '#FCD34D' }}>
            {freshnessRate}%
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            {freshEntities} / {totalEntities}
          </div>
        </div>

        {/* Entity Count */}
        <div>
          <div className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">Total Entities</div>
          <div className="font-mono text-[14px] font-bold text-on-surface">
            {totalEntities.toLocaleString()}
          </div>
          <div className="text-[11px] text-on-surface-variant mt-1">
            {entityFreshness.types.length} type{entityFreshness.types.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </section>
  )
}
