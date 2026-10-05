import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'
import { StatTiles, EmptyState } from '../components/common/Page'
import { AdminSection } from './ui'

/** One briefing's quality figures (poller summary.py `score_briefing`), as /summary/metrics returns them. */
interface BriefingMetrics {
  must_cover_total: number
  must_cover_coverage: number | null
  life_safety_total: number
  life_safety_in_bottom_line: boolean | null
  radio_24h_serious: number
  radio_24h_coverage: number | null
  traffic_total: number
  traffic_coverage: number | null
  format_ok: boolean
  monitor_actions: number
  compound_risks: number
}

interface BriefingRow {
  ts: string
  model: string | null
  posture: string | null
  duration_s: number | null
  usage: { prompt_tokens?: number; completion_tokens?: number } | null
  metrics: BriefingMetrics | null
}

const POSTURES = ['NORMAL', 'ELEVATED', 'HIGH'] as const
const POSTURE_TEXT: Record<string, string> = { NORMAL: 'text-green-ais', ELEVATED: 'text-amber-gold', HIGH: 'text-red-emergency' }

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const when = (ts: string) =>
  new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

function toneFor(v: number | null): 'good' | 'warn' | 'alert' | 'default' {
  if (v == null) return 'default'
  return v >= 0.9 ? 'good' : v >= 0.7 ? 'warn' : 'alert'
}

/** Coverage per briefing, oldest to newest: a bar is the share of the must-cover checklist that briefing mentioned. */
function CoverageTrend({ rows }: { rows: BriefingRow[] }) {
  const ordered = [...rows].reverse().filter((r) => r.metrics)
  if (ordered.length < 2) return null
  const W = 600, H = 70, gap = 2
  const bw = Math.max(2, (W - gap * (ordered.length - 1)) / ordered.length)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[70px]" role="img" aria-label="Must-cover coverage of each briefing, oldest to newest" preserveAspectRatio="none">
      {[0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={H - g * (H - 4)} y2={H - g * (H - 4)} className="stroke-white/10" strokeDasharray="2 4" />)}
      {ordered.map((r, n) => {
        const v = r.metrics!.must_cover_coverage
        const h = v == null ? 3 : Math.max(3, v * (H - 4))
        return (
          <rect key={r.ts} x={n * (bw + gap)} y={H - h} width={bw} height={h}
                className={v == null ? 'fill-white/15' : v >= 0.9 ? 'fill-green-ais' : v >= 0.7 ? 'fill-amber-gold' : 'fill-red-emergency'}>
            <title>{`${when(r.ts)} · ${v == null ? 'nothing on the checklist' : pct(v)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

/** How good have the recent AI briefings been? Tracks the checks the poller scores each one on, so prompt and model
 *  changes can be judged on a run of briefings rather than one. */
export default function AdminSitrep() {
  const [rows, setRows] = useState<BriefingRow[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/summary/metrics?limit=48`, { headers: authHeaders() })
      if (!res.ok) throw new Error(String(res.status))
      setRows(await res.json())
      setError(false)
    } catch { setError(true) }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  if (rows == null) return error ? <EmptyState icon="error">Could not load briefing metrics.</EmptyState> : <EmptyState icon="hourglass_empty">Loading…</EmptyState>
  const scored = rows.filter((r) => r.metrics)
  if (scored.length === 0) return <EmptyState icon="psychology">No briefings have been scored yet.</EmptyState>

  const cov = mean(scored.map((r) => r.metrics!.must_cover_coverage).filter((v): v is number => v != null))
  const life = scored.filter((r) => r.metrics!.life_safety_in_bottom_line != null)
  const lifeHit = life.length ? life.filter((r) => r.metrics!.life_safety_in_bottom_line).length / life.length : null
  const formatOk = scored.filter((r) => r.metrics!.format_ok).length / scored.length
  const dur = mean(scored.map((r) => r.duration_s).filter((v): v is number => v != null))
  const posture = Object.fromEntries(POSTURES.map((p) => [p, rows.filter((r) => r.posture === p).length]))

  return (
    <div className="stack-y-6">
      <AdminSection title={`Last ${scored.length} briefings`}>
        <StatTiles items={[
          { label: 'Must-cover coverage', value: pct(cov), tone: toneFor(cov), hint: 'Serious recent incidents the briefing mentioned' },
          { label: 'Life safety up top', value: pct(lifeHit), tone: toneFor(lifeHit),
            hint: life.length ? `${life.length} briefings had a life-safety item` : 'No life-safety items in this run' },
          { label: 'Format correct', value: pct(formatOk), tone: toneFor(formatOk), hint: 'Bottom line and every required section present' },
          { label: 'Average generation', value: dur == null ? '—' : `${Math.round(dur)}s`, hint: 'Model time per briefing' },
        ]} />
      </AdminSection>

      <AdminSection title="Must-cover coverage per briefing">
        <div className="border border-white/10 bg-surface-container/60 p-3">
          <CoverageTrend rows={rows} />
          <div className="flex justify-between font-mono text-[11px] text-on-surface-variant mt-1">
            <span>{when(scored[scored.length - 1].ts)}</span><span>{when(scored[0].ts)}</span>
          </div>
        </div>
      </AdminSection>

      <AdminSection title="Posture called">
        <div className="flex flex-wrap gap-2">
          {POSTURES.map((p) => (
            <div key={p} className="border border-white/10 bg-surface-container/60 px-3 py-2 min-w-28">
              <div className={`font-mono text-[20px] leading-none ${POSTURE_TEXT[p]}`}>{posture[p]}</div>
              <div className="label-caps mt-1">{p} · {pct(rows.length ? posture[p] / rows.length : null)}</div>
            </div>
          ))}
        </div>
      </AdminSection>

      <AdminSection title="Recent briefings">
        <div className="overflow-x-auto border border-white/10">
          <table className="w-full text-[12px] font-mono">
            <thead>
              <tr className="text-left text-on-surface-variant uppercase tracking-widest text-[10px] border-b border-white/10">
                {['Time', 'Posture', 'Must-cover', 'Life safety', 'Format', '24h serious', 'Traffic', 'Took', 'Tokens'].map((h) => <th key={h} className="px-3 py-2 font-normal whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => {
                const m = r.metrics
                return (
                  <tr key={r.ts} className="hover:bg-white/5">
                    <td className="px-3 py-1.5 whitespace-nowrap">{when(r.ts)}</td>
                    <td className={`px-3 py-1.5 ${POSTURE_TEXT[r.posture ?? ''] ?? ''}`}>{r.posture ?? '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m ? `${pct(m.must_cover_coverage)} of ${m.must_cover_total}` : '—'}</td>
                    <td className="px-3 py-1.5">{m?.life_safety_in_bottom_line == null ? '—' : m.life_safety_in_bottom_line ? 'yes' : <span className="text-red-emergency">missed</span>}</td>
                    <td className="px-3 py-1.5">{m ? (m.format_ok ? 'ok' : <span className="text-red-emergency">broken</span>) : '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m ? `${pct(m.radio_24h_coverage)} of ${m.radio_24h_serious}` : '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m ? `${pct(m.traffic_coverage)} of ${m.traffic_total}` : '—'}</td>
                    <td className="px-3 py-1.5">{r.duration_s == null ? '—' : `${Math.round(r.duration_s)}s`}</td>
                    <td className="px-3 py-1.5">{r.usage?.completion_tokens ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-on-surface-variant">
          Coverage counts how many of the incidents the prompt asked the model to cover were mentioned by place or type.
          The 24h and traffic figures are context, not targets: a good briefing does not list every incident of the day.
        </p>
      </AdminSection>
    </div>
  )
}
