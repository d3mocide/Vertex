import { useState } from 'react'

export type StackSeries = { name: string; color: string; values: number[] }

// Distinct, colour-blind-tolerant hues; series beyond these are grouped as "other".
export const PALETTE = ['#F59E0B', '#38BDF8', '#34D399', '#A78BFA', '#F472B6', '#FB923C']
export const OTHER_COLOR = '#6B7280'

/**
 * Rank series by volume, keep the biggest `max`, and fold the rest into one "other" series.
 * A series with an empty colour gets one from the palette; a caller can pass its own to keep a meaning per name.
 */
export function topSeries(all: StackSeries[], max = PALETTE.length): StackSeries[] {
  const ranked = all.filter((s) => s.values.some((v) => v > 0))
    .sort((a, b) => sum(b.values) - sum(a.values))
  const shown = ranked.slice(0, max).map((x, k) => ({ ...x, color: x.color || PALETTE[k % PALETTE.length] }))
  const rest = ranked.slice(max)
  if (!rest.length) return shown
  const n = shown[0]?.values.length ?? rest[0].values.length
  return [...shown, { name: `other (${rest.length})`, color: OTHER_COLOR, values: Array.from({ length: n }, (_, i) => rest.reduce((s, r) => s + r.values[i], 0)) }]
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

/**
 * All series stacked per time bucket: the shape of the period at a glance. The last bucket is drawn lighter
 * because it is still filling. Hover a bar for the breakdown.
 */
export function StackedChart({ title, series, barLabel, axis, unit = '' }: {
  title: string
  series: StackSeries[]
  /** Label for bucket `i` of `n`; the last bucket is the current, partial one. */
  barLabel: (i: number, n: number) => string
  /** Left, middle and right axis captions. */
  axis: [string, string, string]
  unit?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const n = series[0]?.values.length ?? 0
  if (n === 0) return null
  const totals = Array.from({ length: n }, (_, i) => series.reduce((s, x) => s + x.values[i], 0))
  const max = Math.max(...totals, 1)
  const H = 120
  // Round the axis top to a friendly number so the gridlines are readable.
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const top = Math.ceil(max / step) * step
  const active = hover ?? n - 1

  return (
    <div className="border border-white/10 bg-black/30 p-3 mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 text-[11px] font-mono text-on-surface-variant">
        <span>{title}</span>
        <span className="text-on-surface">
          {barLabel(active, n)}: <b>{totals[active].toLocaleString()}</b>{unit}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-[10px] font-mono text-on-surface-variant text-right w-9" style={{ height: H }} aria-hidden="true">
          <span>{top.toLocaleString()}</span><span>{Math.round(top / 2).toLocaleString()}</span><span>0</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative flex items-end gap-px border-b border-white/15" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            <div className="absolute inset-x-0 top-0 border-t border-white/5" aria-hidden="true" />
            <div className="absolute inset-x-0 top-1/2 border-t border-white/5" aria-hidden="true" />
            {totals.map((tot, i) => (
              <div key={i} className={`flex-1 h-full flex flex-col justify-end ${hover === i ? 'bg-white/5' : ''}`}
                onMouseEnter={() => setHover(i)}
                title={`${barLabel(i, n)}: ${tot.toLocaleString()}${unit}\n${series.filter((s) => s.values[i] > 0).map((s) => `${s.name}: ${s.values[i].toLocaleString()}`).join('\n')}`}>
                {[...series].reverse().map((s) => s.values[i] > 0 && (
                  <div key={s.name} style={{ height: `${(s.values[i] / top) * 100}%`, background: s.color, opacity: i === n - 1 ? 0.6 : 1 }} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant mt-1" aria-hidden="true">
            <span>{axis[0]}</span><span>{axis[1]}</span><span>{axis[2]}</span>
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] font-mono text-on-surface-variant">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 inline-block" style={{ background: s.color }} aria-hidden="true" />{s.name}
            <span className="text-on-surface">{sum(s.values).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Bucket label for a series of hourly buckets whose last bucket is the current hour. */
export function hourLabel(i: number, n: number, now = new Date()): string {
  const ago = n - 1 - i
  if (ago === 0) return 'this hour so far'
  const d = new Date(now.getTime() - ago * 3600_000)
  return `${d.toLocaleTimeString(undefined, { hour: 'numeric' })} (${ago} h ago)`
}
