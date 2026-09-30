import { useState } from 'react'
import type { EventActivityData, EventActivityEntry } from './types'

const HIGH = /emergency|critical|hijack/
// Distinct, colour-blind-tolerant hues for the stacked chart; anything beyond these is grouped as "other".
const PALETTE = ['#F59E0B', '#38BDF8', '#34D399', '#A78BFA', '#F472B6', '#FB923C']
const OTHER = '#6B7280'

/** Label for the hour bucket `i` of a 24-long series whose last bucket is the current (partial) hour. */
function hourLabel(i: number, n: number, now = new Date()): string {
  const ago = n - 1 - i
  if (ago === 0) return 'this hour so far'
  const d = new Date(now.getTime() - ago * 3600_000)
  return `${d.toLocaleTimeString(undefined, { hour: 'numeric' })} (${ago} h ago)`
}

/** One type's hour-by-hour shape, sized to read, with its own peak called out. */
function Bars({ entry }: { entry: EventActivityEntry }) {
  const values = entry.hourly
  const max = Math.max(...values, 1)
  const peak = values.indexOf(Math.max(...values))
  return (
    <div className="flex items-end gap-px h-8 w-40" role="img" aria-label={`${entry.event_type} per hour over the last 24 hours, peaking at ${max}`}>
      {values.map((v, i) => {
        const last = i === values.length - 1
        return (
          <div key={i} title={`${hourLabel(i, values.length)}: ${v.toLocaleString()}`}
            className="flex-1 h-full flex items-end">
            <div className={last ? 'bg-amber-gold/60 w-full' : i === peak && v > 0 ? 'bg-amber-gold w-full' : 'bg-amber-gold/40 w-full'}
              style={{ height: v === 0 ? 1 : `${Math.max(8, (v / max) * 100)}%`, opacity: v === 0 ? 0.3 : 1 }} />
          </div>
        )
      })}
    </div>
  )
}

/** All event types stacked per hour: the shape of the day at a glance, before the per-type detail. */
function StackedChart({ types }: { types: EventActivityEntry[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = types[0]?.hourly.length ?? 24
  const ranked = [...types].filter((t) => t.last_24h > 0).sort((a, b) => b.last_24h - a.last_24h)
  const shown = ranked.slice(0, PALETTE.length)
  const rest = ranked.slice(PALETTE.length)
  const series = [
    ...shown.map((t, k) => ({ name: t.event_type, color: PALETTE[k], values: t.hourly })),
    ...(rest.length ? [{ name: `other (${rest.length})`, color: OTHER, values: Array.from({ length: n }, (_, i) => rest.reduce((s, t) => s + t.hourly[i], 0)) }] : []),
  ]
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
        <span>Events per hour, all types</span>
        <span className="text-on-surface">
          {hourLabel(active, n)}: <b>{totals[active].toLocaleString()}</b>
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-[10px] font-mono text-on-surface-variant text-right w-9" style={{ height: H }} aria-hidden="true">
          <span>{top.toLocaleString()}</span><span>{Math.round(top / 2).toLocaleString()}</span><span>0</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative flex items-end gap-px border-b border-white/15" style={{ height: H }}
            onMouseLeave={() => setHover(null)}>
            <div className="absolute inset-x-0 top-0 border-t border-white/5" aria-hidden="true" />
            <div className="absolute inset-x-0 top-1/2 border-t border-white/5" aria-hidden="true" />
            {totals.map((tot, i) => (
              <div key={i} className={`flex-1 h-full flex flex-col justify-end ${hover === i ? 'bg-white/5' : ''}`}
                onMouseEnter={() => setHover(i)}
                title={`${hourLabel(i, n)}: ${tot.toLocaleString()}\n${series.filter((s) => s.values[i] > 0).map((s) => `${s.name}: ${s.values[i].toLocaleString()}`).join('\n')}`}>
                {[...series].reverse().map((s) => s.values[i] > 0 && (
                  <div key={s.name} style={{ height: `${(s.values[i] / top) * 100}%`, background: s.color, opacity: i === n - 1 ? 0.6 : 1 }} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-on-surface-variant mt-1" aria-hidden="true">
            <span>24 h ago</span><span>12 h ago</span><span>now</span>
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] font-mono text-on-surface-variant">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 inline-block" style={{ background: s.color }} aria-hidden="true" />{s.name}
            <span className="text-on-surface">{s.values.reduce((a, b) => a + b, 0).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Events by type over the last 24 hours, with the all-time total kept as context. */
export function EventActivity({ data }: { data: EventActivityData | null }) {
  if (!data) return null
  const quiet = data.types.filter((t) => t.last_24h === 0)
  const active = data.types.filter((t) => t.last_24h > 0)
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Events
        <span className="ml-2 normal-case tracking-normal font-normal">
          {data.last_24h.toLocaleString()} in the last 24 h · {data.total.toLocaleString()} all time
        </span>
      </h2>
      {data.types.length === 0 ? (
        <div className="border border-white/10 bg-black/30 p-4 text-xs text-on-surface-variant">No events recorded yet.</div>
      ) : (
        <>
          {data.last_24h > 0 && <StackedChart types={data.types} />}
          <div className="border border-white/10 bg-black/30 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="text-[11px] uppercase tracking-widest text-on-surface-variant">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-2 font-normal">Type</th>
                  <th className="px-3 py-2 font-normal text-right">Last hour</th>
                  <th className="px-3 py-2 font-normal text-right">24 h</th>
                  <th className="px-3 py-2 font-normal hidden sm:table-cell">Last 24 h, by hour</th>
                  <th className="px-3 py-2 font-normal text-right hidden md:table-cell">All time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {active.map((t) => {
                  const share = data.last_24h ? Math.round((t.last_24h / data.last_24h) * 100) : 0
                  return (
                    <tr key={t.event_type}>
                      <td className="px-3 py-2 font-mono">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${HIGH.test(t.event_type) ? 'bg-red-emergency' : 'bg-on-surface-variant'}`} aria-hidden="true" />
                        <span className="text-on-surface">{t.event_type}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-on-surface-variant">{t.last_hour.toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-right">
                        <span className="text-on-surface font-bold">{t.last_24h.toLocaleString()}</span>
                        <span className="block text-[10px] text-on-surface-variant">{share < 1 ? '<1' : share}%</span>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell"><Bars entry={t} /></td>
                      <td className="px-3 py-2 font-mono text-right text-on-surface-variant hidden md:table-cell">{t.total.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {quiet.length > 0 && (
            <p className="mt-2 text-[11px] font-mono text-on-surface-variant">
              Quiet for 24 h: {quiet.map((t) => `${t.event_type} (${t.total.toLocaleString()} all time)`).join(' · ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
