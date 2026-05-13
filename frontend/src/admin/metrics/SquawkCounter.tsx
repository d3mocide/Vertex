import React from 'react'
import type { SquawkAlertData } from './types'

const SQUAWK_DEFS = [
  { code: '7500', label: 'Hijack', color: 'text-red-400', border: 'border-red-500/40', bg: 'bg-red-500/10' },
  { code: '7600', label: 'Comm Fail', color: 'text-sky-400', border: 'border-sky-500/40', bg: 'bg-sky-500/10' },
  { code: '7700', label: 'Emergency', color: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
] as const

export function SquawkCounter({ data }: { data: SquawkAlertData | null }) {
  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-gray-500 mb-3">
        Emergency Squawks
        <span className="ml-2 text-gray-600 normal-case tracking-normal">last {data?.window_hours ?? 24}h</span>
      </h2>
      <div className="grid grid-cols-3 gap-3">
        {SQUAWK_DEFS.map(({ code, label, color, border, bg }) => {
          const count = data
            ? code === '7500' ? data.squawk_7500 : code === '7600' ? data.squawk_7600 : data.squawk_7700
            : null
          return (
            <div key={code} className={`border ${border} ${bg} p-3 flex flex-col gap-1`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-2xl font-mono font-bold ${color}`}>
                  {count ?? '—'}
                </span>
                <span className={`text-[11px] font-mono font-bold ${color} opacity-70`}>{code}</span>
              </div>
              <div className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
