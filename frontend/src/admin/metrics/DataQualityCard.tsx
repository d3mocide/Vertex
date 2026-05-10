import React from 'react'
import type { DataQualityData } from './types'

function pctColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500/50'
  if (pct >= 50) return 'bg-amber-500/50'
  return 'bg-red-500/50'
}

function pctText(pct: number): string {
  if (pct >= 80) return 'text-emerald-400'
  if (pct >= 50) return 'text-amber-400'
  return 'text-red-400'
}

export function DataQualityCard({ data }: { data: DataQualityData | null }) {
  if (!data || data.rows.length === 0) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Data Completeness</h2>
        <p className="text-xs text-gray-600">No data.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Data Completeness</h2>
      <div className="space-y-1.5">
        {data.rows.map((row) => (
          <div key={`${row.entity_type}-${row.field}`} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 w-32 shrink-0 truncate">{row.label}</span>
            <div className="flex-1 h-4 bg-black/40 border border-white/5 relative overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${pctColor(row.pct)}`}
                style={{ width: `${row.pct}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono w-10 text-right shrink-0 ${pctText(row.pct)}`}>
              {row.pct}%
            </span>
            <span className="text-[9px] text-gray-600 font-mono w-16 text-right shrink-0">
              {row.present}/{row.total}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
