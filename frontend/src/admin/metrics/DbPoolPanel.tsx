import React from 'react'
import type { DbPoolData } from './types'

function PoolCard({
  label, value, warn = false,
}: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="border border-white/10 bg-black/30 p-3 text-center">
      <div className={`text-xl font-mono font-bold ${warn ? 'text-amber-400' : 'text-gray-300'}`}>{value}</div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  )
}

export function DbPoolPanel({ pool }: { pool: DbPoolData | null }) {
  if (!pool) return null
  if (pool.error) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">DB Connection Pool</h2>
        <p className="text-xs text-red-400">Pool stats unavailable: {pool.error}</p>
      </section>
    )
  }
  const utilization = pool.pool_size > 0 ? pool.checked_out / pool.pool_size : 0

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">DB Connection Pool</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PoolCard label="Pool Size" value={pool.pool_size} />
        <PoolCard label="Active" value={pool.checked_out} warn={utilization > 0.8} />
        <PoolCard label="Idle" value={pool.checked_in} />
        <PoolCard label="Overflow" value={Math.max(0, pool.overflow)} warn={pool.overflow > 0} />
      </div>
      {utilization > 0.8 && (
        <p className="mt-2 text-[10px] text-amber-400">
          ⚠ Pool utilization {Math.round(utilization * 100)}% — consider increasing pool size on Pi.
        </p>
      )}
    </section>
  )
}
