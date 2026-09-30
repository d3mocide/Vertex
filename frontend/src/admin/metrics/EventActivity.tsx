import type { EventActivityData } from './types'

function Bars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <svg viewBox="0 0 96 24" className="w-24 h-6" preserveAspectRatio="none" role="img" aria-label="Events per hour over the last 24 hours">
      {values.map((v, i) => {
        const h = v === 0 ? 0.5 : Math.max(2, (v / max) * 22)
        return <rect key={i} x={i * 4 + 0.5} y={24 - h} width={3} height={h} fill={i === values.length - 1 ? '#FCD34D' : '#B45309'} opacity={i === values.length - 1 ? 0.7 : 1} />
      })}
    </svg>
  )
}

const HIGH = /emergency|critical|hijack/

/** Events by type over the last 24 hours, with the all-time total kept as context. */
export function EventActivity({ data }: { data: EventActivityData | null }) {
  if (!data) return null
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
        <div className="border border-white/10 bg-black/30 overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] uppercase tracking-widest text-on-surface-variant">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal text-right">Last hour</th>
                <th className="px-3 py-2 font-normal text-right">24 h</th>
                <th className="px-3 py-2 font-normal">By hour</th>
                <th className="px-3 py-2 font-normal text-right hidden md:table-cell">All time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.types.map((t) => (
                <tr key={t.event_type} className={t.last_24h === 0 ? 'opacity-50' : ''}>
                  <td className="px-3 py-1.5 font-mono">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${HIGH.test(t.event_type) ? 'bg-red-emergency' : 'bg-on-surface-variant'}`} aria-hidden="true" />
                    <span className="text-on-surface">{t.event_type}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-right text-on-surface-variant">{t.last_hour.toLocaleString()}</td>
                  <td className="px-3 py-1.5 font-mono text-right text-on-surface font-bold">{t.last_24h.toLocaleString()}</td>
                  <td className="px-3 py-1.5"><Bars values={t.hourly} /></td>
                  <td className="px-3 py-1.5 font-mono text-right text-on-surface-variant hidden md:table-cell">{t.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
