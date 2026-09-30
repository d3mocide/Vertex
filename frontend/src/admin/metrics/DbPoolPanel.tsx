import type { DbPoolData } from './types'

export function DbPoolPanel({ pool }: { pool: DbPoolData | null }) {
  if (!pool) return null
  if (pool.error) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">DB Connection Pool</h2>
        <div className="border border-white/10 bg-black/30 p-4">
          <p className="text-xs text-red-emergency">Pool stats unavailable: {pool.error}</p>
        </div>
      </section>
    )
  }
  // Judged against the pool's real capacity (base pool plus the overflow it may open), by the backend.
  const critical = pool.level === 'critical'
  const warn = pool.level === 'warn'
  const pct = Math.round(pool.utilization * 100)

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant">
        Database connections
        <span className="ml-2 normal-case tracking-normal font-normal">one backend worker, a snapshot: brief spikes are normal</span>
      </h2>
      <div className="border border-white/10 bg-black/30 p-3 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 font-mono text-[12px] text-on-surface-variant">
          <span><span className={`text-lg font-bold ${critical ? 'text-red-emergency' : warn ? 'text-amber-gold' : 'text-on-surface'}`}>{pool.checked_out}</span> in use</span>
          <span><span className="text-on-surface">{pool.checked_in}</span> idle</span>
          <span><span className="text-on-surface">{pool.capacity}</span> capacity ({pool.pool_size} + {pool.max_overflow} overflow)</span>
          {pool.overflow_in_use > 0 && <span><span className="text-on-surface">{pool.overflow_in_use}</span> using overflow</span>}
          <span className="ml-auto text-on-surface font-bold">{pct}%</span>
        </div>
        <div className="h-1.5 bg-surface-container-highest">
          <div className={`h-full ${critical ? 'bg-red-emergency' : warn ? 'bg-amber-gold' : 'bg-emerald-300'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        {pool.message && (
          <div className={`flex gap-2 p-2 border text-xs ${critical ? 'bg-red-emergency/10 border-red-emergency/40 text-red-emergency' : 'bg-amber-gold/10 border-amber-gold/40 text-amber-gold'}`}>
            <span className="ms text-[16px] shrink-0" aria-hidden="true">{critical ? 'error' : 'warning'}</span>
            <span>{pool.message}</span>
          </div>
        )}
      </div>
    </section>
  )
}
