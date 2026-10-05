import type { EntityActivityData, EntityActivityEntry } from './types'
import { StackedChart, hourLabel, topSeries } from './StackedChart'

function HourlyBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  return (
    <svg viewBox="0 0 96 24" className="w-24 h-6 shrink-0" preserveAspectRatio="none" role="img"
      aria-label={`Per hour over the last 24 hours; peak ${max}`}>
      {values.map((v, i) => {
        const h = v === 0 ? 0.5 : Math.max(2, (v / max) * 22)
        return <rect key={i} x={i * 4 + 0.5} y={24 - h} width={3} height={h}
          fill={i === values.length - 1 ? '#5EEAD4' : '#0E7490'} opacity={i === values.length - 1 ? 0.6 : 1} />
      })}
    </svg>
  )
}

const pretty = (t: EntityActivityEntry) => t.label ?? t.entity_type.replace(/_/g, ' ')

function Status({ t }: { t: EntityActivityEntry }) {
  if (t.group === 'dispatch') return null
  if (!t.continuous) return <span className="text-[10px] uppercase tracking-widest text-on-surface-variant" title="Updates only when the source reports a change">event-driven</span>
  return (
    <span className={`text-[10px] uppercase tracking-widest ${t.live ? 'text-green-ais' : 'text-amber-gold'}`}
      title={`The newest sighting must be within ${t.live_window_min} min for this feed to count as live`}>
      {t.live ? 'live' : 'quiet'}
    </span>
  )
}

function Extra({ t }: { t: EntityActivityEntry }) {
  const x = t.extra
  if (!x) return null
  const bits: string[] = []
  if (x.transcribed_pct != null) bits.push(`${x.transcribed_pct}% transcribed`)
  if (x.avg_duration_s != null) bits.push(`avg ${x.avg_duration_s}s`)
  if (x.located_pct != null) bits.push(`${x.located_pct}% located on map`)
  if (x.life_safety) bits.push(`${x.life_safety} life-safety`)
  return (
    <div className="text-[11px] text-on-surface-variant font-mono">
      {bits.join(' · ')}
      {x.categories && x.categories.length > 0 && (
        <div className="mt-0.5">{x.categories.map(([c, n]) => `${c.replace(/_/g, ' ')} ${n}`).join(' · ')}</div>
      )}
    </div>
  )
}

function Table({ rows, activeWindow }: { rows: EntityActivityEntry[]; activeWindow: number }) {
  return (
    <div className="border border-white/10 bg-black/30 overflow-x-auto">
      <table className="w-full table-fixed text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-widest text-on-surface-variant">
          <tr className="border-b border-white/10">
            <th className="px-3 py-2 font-normal">Type</th>
            <th className="px-2 sm:px-3 py-2 font-normal text-right w-16 sm:w-28 whitespace-nowrap"><span className="sm:hidden">Now</span><span className="hidden sm:inline">Active now</span></th>
            <th className="px-2 sm:px-3 py-2 font-normal text-right w-16 sm:w-20 whitespace-nowrap">In 24 h</th>
            <th className="px-3 py-2 font-normal w-32 hidden sm:table-cell">By hour</th>
            <th className="px-3 py-2 font-normal text-right w-24 hidden md:table-cell">Dormant</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((t) => (
            <tr key={t.entity_type} className="align-top">
              <td className="px-3 py-2">
                <div className="font-mono text-on-surface capitalize">{pretty(t)}</div>
                <Status t={t} />
                <Extra t={t} />
              </td>
              <td className="px-3 py-2 text-right font-mono text-base font-bold text-on-surface"
                title={`seen in the last ${t.active_window_min ?? activeWindow} min`}>{t.active_now.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono text-on-surface-variant">{t.seen_24h.toLocaleString()}</td>
              <td className="px-3 py-2 hidden sm:table-cell"><HourlyBars values={t.hourly} /></td>
              <td className="px-3 py-2 text-right font-mono text-on-surface-variant hidden md:table-cell">
                {t.group === 'dispatch' ? '—' : t.dormant.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * What is active, as counts rather than percentages: aircraft, vessels and mesh nodes come and go, so most of
 * what is seen over a day is naturally "not current". What matters is how many are active now, the shape of
 * the day, and whether the feed behind each type is still delivering. Radio calls and the dispatch incidents
 * extracted from them are tracked the same way.
 */
export function EntityActivity({ data }: { data: EntityActivityData | null }) {
  if (!data || data.types.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">Activity</h2>
        <div className="border border-white/10 bg-black/30 p-4 text-center text-[11px] text-on-surface-variant">Nothing tracked yet.</div>
      </section>
    )
  }
  const entities = data.types.filter((t) => t.group !== 'dispatch')
  const dispatch = data.types.filter((t) => t.group === 'dispatch')
  return (
    <div className="stack-y-6">
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
          Map entities
          <span className="ml-2 normal-case tracking-normal font-normal">active = seen in the last {data.active_window_min} min</span>
        </h2>
        <StackedChart title="Distinct entities seen per hour" barLabel={hourLabel} axis={['24 h ago', '12 h ago', 'now']}
          series={topSeries(entities.map((t) => ({ name: pretty(t), color: '', values: t.hourly })))} />
        <Table rows={entities} activeWindow={data.active_window_min} />
        <p className="mt-2 text-[11px] text-on-surface-variant">
          Dormant entities are known from earlier but not seen in 24 hours; the registry keeps them.
        </p>
      </section>
      {dispatch.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
            Dispatch
            <span className="ml-2 normal-case tracking-normal font-normal">radio calls and the incidents extracted from them</span>
          </h2>
          <Table rows={dispatch} activeWindow={data.active_window_min} />
        </section>
      )}
    </div>
  )
}
