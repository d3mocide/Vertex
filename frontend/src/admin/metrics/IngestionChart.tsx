import React from 'react'
import type { IngestionBucket } from './types'

const TYPE_COLORS: Record<string, string> = {
  aircraft: '#00E5FF',
  vessel: '#00FF88',
  aprs: '#FFB800',
  p25: '#FFB800',
  meshcore: '#C084FC',
}
const FALLBACK = '#94A3B8'

function getColor(type: string) {
  return TYPE_COLORS[type.toLowerCase()] ?? FALLBACK
}

export function IngestionChart({ buckets }: { buckets: IngestionBucket[] }) {
  if (buckets.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Ingestion Rate</h2>
        <div className="border border-white/10 bg-black/30 p-4 text-xs text-gray-500">
          Collecting data — chart available after first observations.
        </div>
      </section>
    )
  }

  // Build per-type series indexed by minute string
  const types = [...new Set(buckets.map((b) => b.type))]
  const minutes = [...new Set(buckets.map((b) => b.minute))].sort()

  // Map: minute → type → count
  const grid: Record<string, Record<string, number>> = {}
  for (const m of minutes) grid[m] = {}
  for (const b of buckets) grid[b.minute][b.type] = b.count

  const W = 600
  const H = 200
  const maxCount = Math.max(...buckets.map((b) => b.count), 1)

  const xOf = (i: number) => (i / Math.max(minutes.length - 1, 1)) * W
  const yOf = (v: number) => H - (v / maxCount) * (H - 8) - 4

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Ingestion Rate (60 min)</h2>
      <div className="border border-white/10 bg-black/30 p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} preserveAspectRatio="none">
          {types.map((t) => {
            const pts = minutes.map((m, i) => `${xOf(i)},${yOf(grid[m][t] ?? 0)}`).join(' ')
            const color = getColor(t)
            const last = minutes.length - 1
            const areaClose = ` L ${xOf(last)},${H} L 0,${H} Z`
            const gradId = `ig-${t}`
            return (
              <g key={t}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                    <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                  </linearGradient>
                </defs>
                <path d={`M ${pts}${areaClose}`} fill={`url(#${gradId})`} />
                <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
              </g>
            )
          })}
        </svg>
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2">
          {types.map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: getColor(t) }} />
              <span className="text-[11px] font-mono text-gray-400 uppercase">{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
