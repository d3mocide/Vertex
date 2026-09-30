import type { DataQualityData } from './types'

// Red only for genuinely poor: several of these depend on best-effort steps (transcription, geocoding), where
// 60-90% is normal.
const barColor = (p: number) => (p >= 90 ? 'bg-emerald-500' : p >= 40 ? 'bg-amber-500' : 'bg-red-500')
const textColor = (p: number) => (p >= 90 ? 'text-emerald-300' : p >= 40 ? 'text-amber-400' : 'text-red-400')

/**
 * How complete the fields that should always be present are, over the last 24 h. Fields that a source
 * cannot provide (signal strength on vessels, battery from MeshCore) are deliberately not listed: they would
 * only ever read 0% and say nothing about health.
 */
export function DataQualityCard({ data }: { data: DataQualityData | null }) {
  if (!data || data.rows.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">Completeness</h2>
        <p className="text-xs text-on-surface-variant/60">No data.</p>
      </section>
    )
  }
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Completeness
        <span className="ml-2 normal-case tracking-normal font-normal">how many have the field, last 24 h</span>
      </h2>
      <div className="border border-white/10 bg-black/30 divide-y divide-white/5">
        {data.rows.map((row) => (
          <div key={`${row.entity_type}-${row.field}`} className="flex items-center gap-3 px-3 py-2">
            <div className="w-56 min-w-0 truncate text-[12px] text-on-surface" title={`${row.label} (${row.field})`}>
              {row.label.replace(/^(\w+ ?\w*) - /, '$1 · ')}
            </div>
            <div className="flex-1 h-1.5 bg-surface-container-highest min-w-[3rem]">
              <div className={`h-full ${barColor(row.pct)}`} style={{ width: `${Math.min(row.pct, 100)}%` }} />
            </div>
            <div className={`w-14 text-right font-mono text-[12px] font-bold ${textColor(row.pct)}`}>{row.pct}%</div>
            <div className="w-28 text-right font-mono text-[11px] text-on-surface-variant hidden sm:block">
              {row.present.toLocaleString()}/{row.total.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
