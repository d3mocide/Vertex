import type { IngestionBucket } from './types'

const COLORS: Record<string, string> = {
  aircraft: '#00BFFF', vessel: '#00C853', aprs: '#B388FF', mesh_node: '#76DD00',
  train: '#FFC107', stream_gauge: '#4FC3F7', fire_incident: '#EF5350', sensor: '#76DD00',
}
const color = (t: string) => COLORS[t] ?? '#9CA3AF'

function Spark({ values, type }: { values: number[]; type: string }) {
  const max = Math.max(...values, 1)
  return (
    <svg viewBox="0 0 96 24" className="w-24 h-6" preserveAspectRatio="none" role="img" aria-label="Observations per 5 minutes over the last hour">
      {values.map((v, i) => {
        const h = v === 0 ? 0.5 : Math.max(2, (v / max) * 22)
        return <rect key={i} x={i * 8 + 1} y={24 - h} width={6} height={h} fill={color(type)} opacity={0.85} />
      })}
    </svg>
  )
}

/**
 * Observations written per entity type over the last hour. Some sources write in batches (all mesh nodes
 * at once, every gauge at once), which makes a per-minute line chart look like a few enormous spikes, so
 * this shows totals, averages, the peak minute and the shape in five-minute steps instead.
 */
export function IngestByType({ buckets }: { buckets: IngestionBucket[] }) {
  if (buckets.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">Observations written</h2>
        <div className="border border-white/10 bg-black/30 p-4 text-[11px] text-on-surface-variant text-center">No observations in the last hour.</div>
      </section>
    )
  }

  const minutes = [...new Set(buckets.map((b) => b.minute))].sort()
  const slot = new Map(minutes.map((m, i) => [m, i]))
  const span = Math.max(minutes.length, 60)
  const byType = new Map<string, number[]>()
  for (const b of buckets) {
    const arr = byType.get(b.type) ?? new Array(minutes.length).fill(0)
    arr[slot.get(b.minute)!] += b.count
    byType.set(b.type, arr)
  }

  const rows = [...byType.entries()].map(([type, perMinute]) => {
    const total = perMinute.reduce((a, b) => a + b, 0)
    const peak = Math.max(...perMinute)
    const avg = total / span
    // Twelve five-minute totals, newest last.
    const chunks: number[] = []
    for (let i = perMinute.length; i > 0 && chunks.length < 12; i -= 5) {
      chunks.unshift(perMinute.slice(Math.max(0, i - 5), i).reduce((a, b) => a + b, 0))
    }
    while (chunks.length < 12) chunks.unshift(0)
    return { type, total, avg, peak, chunks, batchy: avg > 0 && peak / avg > 8 }
  }).sort((a, b) => b.total - a.total)

  const grand = rows.reduce((a, r) => a + r.total, 0)

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        Observations written
        <span className="ml-2 normal-case tracking-normal font-normal">
          last hour · {grand.toLocaleString()} total · {(grand / span).toFixed(0)}/min
        </span>
      </h2>
      <div className="border border-white/10 bg-black/30 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="text-[11px] uppercase tracking-widest text-on-surface-variant">
            <tr className="border-b border-white/10">
              <th className="px-3 py-2 font-normal">Type</th>
              <th className="px-3 py-2 font-normal text-right">Last hour</th>
              <th className="px-3 py-2 font-normal text-right hidden sm:table-cell">Avg / min</th>
              <th className="px-3 py-2 font-normal text-right hidden md:table-cell">Peak min</th>
              <th className="px-3 py-2 font-normal">Shape</th>
              <th className="px-3 py-2 font-normal text-right hidden md:table-cell">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((r) => (
              <tr key={r.type}>
                <td className="px-3 py-1.5">
                  <span className="inline-block w-2 h-2 mr-2" style={{ background: color(r.type) }} aria-hidden="true" />
                  <span className="font-mono text-on-surface capitalize">{r.type.replace(/_/g, ' ')}</span>
                  {r.batchy && <span className="ml-2 text-[10px] uppercase tracking-widest text-on-surface-variant" title="Written in bursts: all entities at once each poll">batched</span>}
                </td>
                <td className="px-3 py-1.5 font-mono text-on-surface text-right">{r.total.toLocaleString()}</td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant text-right hidden sm:table-cell">{r.avg.toFixed(1)}</td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant text-right hidden md:table-cell">{r.peak.toLocaleString()}</td>
                <td className="px-3 py-1.5"><Spark values={r.chunks} type={r.type} /></td>
                <td className="px-3 py-1.5 font-mono text-on-surface-variant text-right hidden md:table-cell">{r.total / grand < 0.01 ? '<1' : Math.round((r.total / grand) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
