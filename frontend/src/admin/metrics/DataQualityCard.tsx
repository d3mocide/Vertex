import React from 'react'
import type { DataQualityData } from './types'

function pctColor(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500'
  if (pct >= 70) return 'bg-emerald-600'
  if (pct >= 50) return 'bg-amber-500'
  if (pct >= 25) return 'bg-orange-500'
  return 'bg-red-500'
}

function pctText(pct: number): string {
  if (pct >= 90) return 'text-emerald-300'
  if (pct >= 70) return 'text-emerald-400'
  if (pct >= 50) return 'text-amber-400'
  if (pct >= 25) return 'text-orange-400'
  return 'text-red-400'
}

export function DataQualityCard({ data }: { data: DataQualityData | null }) {
  if (!data || data.rows.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">Data Completeness</h2>
        <p className="text-xs text-gray-600">No data.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-4">Data Completeness</h2>
      <div className="border border-white/10 bg-black/30 p-4">
        <div className="space-y-3">
          {data.rows.map((row) => (
            <div key={`${row.entity_type}-${row.field}`} className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-[11px] text-on-surface font-mono capitalize">
                    {row.entity_type.replace(/_/g, ' ')} — {row.label}
                  </div>
                  <div className="text-[11px] text-on-surface-variant mt-0.5">
                    {row.field}
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-[12px] font-mono font-bold ${pctText(row.pct)}`}>
                    {row.pct}%
                  </span>
                  <span className="text-[11px] text-gray-500 font-mono">
                    ({row.present}/{row.total})
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800">
                <div
                  className={`h-full transition-all duration-500 ${pctColor(row.pct)}`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
