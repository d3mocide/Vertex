import type { EntityFreshnessData } from './types'

const BUCKETS = [
  { key: 'fresh_5m',   label: '< 5 min',   color: '#4ADE80' },
  { key: 'recent_15m', label: '5–15 min',  color: '#FCD34D' },
  { key: 'stale_60m',  label: '15–60 min', color: '#FB923C' },
  { key: 'very_stale', label: '> 60 min',  color: '#6B7280' },
] as const

export function EntityFreshness({ data }: { data: EntityFreshnessData | null }) {
  if (!data || data.types.length === 0) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Entity Freshness</h2>
        <div className="hud-panel p-4 text-center text-[10px] text-on-surface-variant">No entities tracked.</div>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">
        Entity Freshness
        <span className="ml-2 text-on-surface-variant normal-case tracking-normal font-normal">
          (time since last observation)
        </span>
      </h2>
      <div className="hud-panel p-4 space-y-4">
        {/* Legend */}
        <div className="flex items-center gap-4 flex-wrap">
          {BUCKETS.map(b => (
            <div key={b.key} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
              <span className="text-[9px] text-on-surface-variant">{b.label}</span>
            </div>
          ))}
        </div>

        {/* Per-type stacked bars */}
        <div className="space-y-3">
          {data.types.map((entry) => {
            const total = entry.total || 1
            return (
              <div key={entry.entity_type} className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] text-on-surface capitalize">
                    {entry.entity_type.replace(/_/g, ' ')}
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] font-bold text-green-400">
                      {entry.fresh_5m}
                    </span>
                    <span className="text-[9px] text-on-surface-variant">/ {entry.total} total</span>
                  </div>
                </div>
                {/* Stacked bar */}
                <div className="flex h-2 rounded-full overflow-hidden bg-surface-container">
                  {BUCKETS.map(b => {
                    const count = entry[b.key]
                    const pct = (count / total) * 100
                    if (pct === 0) return null
                    return (
                      <div
                        key={b.key}
                        className="h-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: b.color }}
                        title={`${b.label}: ${count}`}
                      />
                    )
                  })}
                </div>
                {/* Bucket breakdown */}
                <div className="flex justify-between">
                  {BUCKETS.map(b => (
                    <span key={b.key} className="text-[8px] font-mono" style={{ color: b.color }}>
                      {entry[b.key]}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
