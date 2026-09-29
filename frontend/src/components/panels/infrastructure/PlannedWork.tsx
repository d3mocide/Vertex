import type { TrafficIncident } from '../../../storeTypes'
import { formatIncidentAge, incidentAgeDays } from '../../../incidentUtils'

/** Roadwork and notices with little or no impact: kept, but folded away so they don't bury the closures. */
export function PlannedWork({ incidents, hiddenStale }: { incidents: TrafficIncident[]; hiddenStale: number }) {
  if (incidents.length === 0 && hiddenStale === 0) return null
  return (
    <details className="group border-t border-amber-gold-muted/30 pt-4">
      <summary className="cursor-pointer list-none flex items-center gap-2 text-[12px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
        <span className="ms text-[16px] group-open:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
        Planned work &amp; low-impact notices
        <span className="font-mono text-amber-gold">{incidents.length}</span>
        {hiddenStale > 0 && <span className="font-mono text-[11px] normal-case tracking-normal">· {hiddenStale} older than 30 days hidden</span>}
      </summary>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-x-6">
        {incidents.map((inc, i) => (
          <div key={`${inc.title}-${i}`} className="py-2 border-b border-white/5">
            <div className="flex items-start gap-3">
              <p className="flex-1 text-[12px] text-on-surface leading-snug line-clamp-2">
                {(inc.description ?? '').split(/(?<=[.!?])\s/)[0] || inc.title}
              </p>
              <span className="font-mono text-[11px] text-on-surface-variant shrink-0">{inc.dist_km != null ? `${Math.round(inc.dist_km)} km` : ''}</span>
            </div>
            <div className="font-mono text-[11px] text-on-surface-variant truncate">
              {(inc.location ?? '').trim()}{formatIncidentAge(incidentAgeDays(inc)) ? ` · ${formatIncidentAge(incidentAgeDays(inc))}` : ''}
            </div>
          </div>
        ))}
      </div>
    </details>
  )
}
