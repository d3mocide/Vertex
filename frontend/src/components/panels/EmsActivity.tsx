import { useEffect, useState } from 'react'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface EmsSyndrome {
  key: string
  label: string
  count: number
  count_6h: number
  baseline: number | null
  baseline_6h: number | null
  flag: boolean
}

interface EmsFeed {
  ts: string | null
  reports: number
  reports_baseline: number | null
  baseline_days: number
  building: boolean
  flags: string[]
  syndromes: EmsSyndrome[]
}

const POLL_MS = 5 * 60 * 1000
// Days of history the poller needs before it gives a surge verdict (ems_syndromes.surge_report min_baseline_days).
const BASELINE_DAYS_NEEDED = 5

function usual(value: number | null): string {
  return value == null ? '—' : `~${Number.isInteger(value) ? value : value.toFixed(1)}`
}

/**
 * Medics' pre-arrival reports to hospitals, counted per syndrome and compared with the same hours on earlier days.
 * Only counts exist (no patient details); the poller flags a syndrome when it is unusually high.
 */
export function EmsActivity() {
  const [feed, setFeed] = useState<EmsFeed | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/radio/ems-activity`, { headers: authHeaders(), signal: controller.signal })
        if (!res.ok) return
        const data = (await res.json()) as EmsFeed
        if (data && Array.isArray(data.syndromes)) setFeed(data)
      } catch {
        /* best-effort: keep showing the last good snapshot */
      }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [])

  if (!feed || !feed.ts) return null

  const rows = [...feed.syndromes]
    .filter((s) => s.count > 0 || s.flag)
    .sort((a, b) => Number(b.flag) - Number(a.flag) || b.count - a.count)
  const flagged = feed.flags.length

  return (
    <div id="sec-ems" className="stack-y-3 scroll-mt-4">
      <div className="flex items-center gap-2">
        <span className="ms text-on-surface-variant">monitor_heart</span>
        <h3 className="section-heading mb-0!">EMS Patient Reports</h3>
        <span className="label-caps ml-auto">Hospital radio · 24h</span>
      </div>

      <div className="border border-white/10 bg-surface-container/40 p-3 stack-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="data-value">{feed.reports} reports</span>
          {feed.reports_baseline != null && (
            <span className="font-mono text-[11px] text-on-surface-variant">usual {usual(feed.reports_baseline)}</span>
          )}
          {feed.building ? (
            <span className="status-pill tl-yellow">Baseline {Math.min(feed.baseline_days, BASELINE_DAYS_NEEDED)}/{BASELINE_DAYS_NEEDED} days</span>
          ) : flagged > 0 ? (
            <span className="status-pill tl-yellow">{flagged} unusually high</span>
          ) : (
            <span className="status-pill tl-green">Normal volume</span>
          )}
        </div>

        {rows.length > 0 && (
          <ul className="divide-y divide-white/5">
            {rows.map((s) => (
              <li
                key={s.key}
                className={`flex items-baseline gap-3 py-1.5 ${s.flag ? 'border-l-2 border-amber-gold pl-2' : 'pl-2'}`}
              >
                <span className={`flex-1 min-w-0 truncate text-[13px] ${s.flag ? 'text-on-surface font-bold' : 'text-on-surface'}`}>{s.label}</span>
                <span className={`font-mono text-[12px] ${s.flag ? 'text-amber-gold' : 'text-on-surface'}`}>{s.count}</span>
                <span className="font-mono text-[11px] text-on-surface-variant w-20 text-right">usual {usual(s.baseline)}</span>
                <span className="font-mono text-[11px] text-on-surface-variant w-24 text-right hidden sm:inline">6h {s.count_6h} / {usual(s.baseline_6h)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-on-surface-variant">
          Counts of medics&apos; pre-arrival reports to hospitals. No patient details are stored. A syndrome is flagged when it is well above the same hours on earlier days.
        </p>
      </div>
    </div>
  )
}
