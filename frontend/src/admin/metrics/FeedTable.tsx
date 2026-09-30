import { useState } from 'react'
import type { FeedRow } from './types'

const STATUS = {
  ok:        { dot: 'bg-green-ais',          text: 'text-green-ais',          label: 'on schedule' },
  stale:     { dot: 'bg-amber-gold',         text: 'text-amber-gold',         label: 'late' },
  down:      { dot: 'bg-red-emergency',      text: 'text-red-emergency',      label: 'not updating' },
  on_change: { dot: 'bg-on-surface-variant', text: 'text-on-surface-variant', label: 'on change' },
} as const

const isLate = (f: FeedRow) => f.status === 'stale' || f.status === 'down'

function span(s: number): string {
  if (s < 90) return `${Math.round(s)} s`
  if (s < 5400) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1)} h`
}

function Rows({ feeds }: { feeds: FeedRow[] }) {
  return (
    <div className="border border-white/10 bg-black/30 overflow-x-auto">
      <table className="w-full text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-widest text-on-surface-variant">
          <tr className="border-b border-white/10">
            <th className="px-3 py-2 font-normal">Source</th>
            <th className="px-3 py-2 font-normal">Last update</th>
            <th className="px-3 py-2 font-normal hidden md:table-cell">Expected within</th>
            <th className="px-3 py-2 font-normal hidden sm:table-cell text-right">Records</th>
            <th className="px-3 py-2 font-normal text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {feeds.map((f) => {
            const st = STATUS[f.status]
            return (
              <tr key={f.key}>
                <td className="px-3 py-1.5">
                  <span className="text-on-surface">{f.label}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-widest text-on-surface-variant/70">{f.group}</span>
                </td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant">{span(f.age_s)} ago</td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant hidden md:table-cell">{f.max_age_s ? span(f.max_age_s) : '—'}</td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant hidden sm:table-cell text-right">{f.items !== null ? f.items.toLocaleString() : '—'}</td>
                <td className={`px-3 py-1.5 text-right font-mono text-[11px] uppercase tracking-wider ${st.text}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${st.dot}`} aria-hidden="true" />{st.label}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Every data source the poller publishes, judged against how often it should update. When everything is on
 * schedule that is one line of group chips; only feeds running late get rows, and the full list is a click away.
 * Covers more than map entities: cameras, lightning, alerts, outages, radio incidents, news and so on.
 */
export function FeedTable({ feeds }: { feeds: FeedRow[] }) {
  const [showAll, setShowAll] = useState(false)
  if (feeds.length === 0) return null

  const late = feeds.filter(isLate)
  const groups = new Map<string, { total: number; late: number }>()
  for (const f of feeds) {
    const g = groups.get(f.group) ?? { total: 0, late: 0 }
    g.total += 1
    if (isLate(f)) g.late += 1
    groups.set(f.group, g)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant">
        Data sources
        <span className="ml-2 normal-case tracking-normal font-normal">
          {feeds.length} feeds · {late.length ? `${late.length} running late` : 'all on schedule'}
        </span>
      </h2>

      <div className="flex flex-wrap gap-2">
        {[...groups.entries()].map(([name, g]) => (
          <span key={name} className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-mono ${
            g.late ? 'border-amber-gold/40 text-amber-gold' : 'border-white/10 text-on-surface-variant'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${g.late ? 'bg-amber-gold' : 'bg-green-ais'}`} aria-hidden="true" />
            {name} {g.total - g.late}/{g.total}
          </span>
        ))}
      </div>

      {late.length > 0 && <Rows feeds={late} />}

      <button type="button" onClick={() => setShowAll((v) => !v)}
        className="text-[11px] font-bold uppercase tracking-widest text-amber-gold hover:underline">
        {showAll ? 'Hide' : 'Show'} all {feeds.length} feeds {showAll ? '▴' : '▾'}
      </button>
      {showAll && <Rows feeds={feeds} />}
    </section>
  )
}
