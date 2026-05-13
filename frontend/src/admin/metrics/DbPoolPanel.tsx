import React from 'react'
import type { DbPoolData } from './types'

function PoolCard({
  label, value, warn = false, critical = false,
}: { label: string; value: number | string; warn?: boolean; critical?: boolean }) {
  let colorClass = 'text-gray-300'
  if (critical) colorClass = 'text-red-emergency'
  else if (warn) colorClass = 'text-amber-gold'

  return (
    <div className="border border-white/10 bg-black/30 p-3 text-center">
      <div className={`text-xl font-mono font-bold ${colorClass}`}>{value}</div>
      <div className="text-[11px] text-gray-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}

export function DbPoolPanel({ pool }: { pool: DbPoolData | null }) {
  if (!pool) return null
  if (pool.error) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">DB Connection Pool</h2>
        <div className="border border-white/10 bg-black/30 p-4">
          <p className="text-xs text-red-emergency">Pool stats unavailable: {pool.error}</p>
        </div>
      </section>
    )
  }
  const utilization = pool.pool_size > 0 ? pool.checked_out / pool.pool_size : 0
  const utilizationPercent = Math.round(utilization * 100)

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500">DB Connection Pool</h2>
      <div className="border border-white/10 bg-black/30 space-y-4 p-4">
        {/* Pool cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PoolCard label="Pool Size" value={pool.pool_size} />
          <PoolCard label="Active" value={pool.checked_out} warn={utilization > 0.7} critical={utilization > 0.9} />
          <PoolCard label="Idle" value={pool.checked_in} />
          <PoolCard label="Overflow" value={Math.max(0, pool.overflow)} critical={pool.overflow > 0} />
        </div>

        {/* Utilization bar */}
        <div className="flex items-center gap-4">
          <span className="text-[11px] uppercase tracking-widest text-gray-500 shrink-0">Utilization</span>
          <div className="flex-1 h-1.5 bg-gray-800">
            <div
              className={`h-full transition-all ${utilizationPercent > 90 ? 'bg-red-emergency' : utilizationPercent > 70 ? 'bg-amber-gold' : 'bg-emerald-300'}`}
              style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-gray-300 min-w-[3rem] text-right">{utilizationPercent}%</span>
        </div>

        {/* Warnings */}
        {pool.overflow > 0 && (
          <div className="flex gap-2 p-2 bg-red-emergency/10 border border-red-emergency/40 text-xs text-red-emergency">
            <span className="material-symbols text-sm shrink-0">error</span>
            <span>{pool.overflow} overflow connection(s) — pool exhausted. Increase size or reduce concurrent queries.</span>
          </div>
        )}
        {utilization > 0.9 && pool.overflow === 0 && (
          <div className="flex gap-2 p-2 bg-red-emergency/10 border border-red-emergency/40 text-xs text-red-emergency">
            <span className="material-symbols text-sm shrink-0">error</span>
            <span>Pool at {utilizationPercent}% utilization — increase pool size immediately.</span>
          </div>
        )}
        {utilization > 0.7 && utilization <= 0.9 && (
          <div className="flex gap-2 p-2 bg-amber-gold/10 border border-amber-gold/40 text-xs text-amber-gold">
            <span className="material-symbols text-sm shrink-0">warning</span>
            <span>Pool at {utilizationPercent}% — consider increasing pool size to avoid timeouts.</span>
          </div>
        )}
      </div>
    </section>
  )
}
