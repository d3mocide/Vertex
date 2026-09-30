import type { EventActivityData, EventActivityEntry } from './types'
import { StackedChart, hourLabel, topSeries } from './StackedChart'

const HIGH = /emergency|critical|hijack/

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
          {data.last_24h > 0 && (
            <StackedChart title="Events per hour, all types" barLabel={hourLabel} axis={['24 h ago', '12 h ago', 'now']}
              series={topSeries(data.types.map((t) => ({ name: t.event_type, color: '', values: t.hourly })))} />
          )}
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
