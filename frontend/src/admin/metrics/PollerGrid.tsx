import React from 'react'
import type { PollerEntry } from './types'

function relativeTime(staleness: number): string {
  if (staleness < 5) return 'just now'
  if (staleness < 60) return `${Math.round(staleness)}s ago`
  if (staleness < 3600) return `${Math.round(staleness / 60)}m ago`
  return `${Math.round(staleness / 3600)}h ago`
}

function PollerCell({ p }: { p: PollerEntry }) {
  const isOk = p.status === 'ok'
  const isError = p.status === 'error'
  const isStale = p.status === 'stale'

  const border = isError ? 'border-red-500/40' : isStale ? 'border-amber-500/30' : 'border-white/10'
  const dot = isError ? 'bg-red-400' : isStale ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
  const pill = isError
    ? 'text-red-400'
    : isStale
    ? 'text-amber-400'
    : 'text-emerald-400'

  return (
    <div className={`border ${border} bg-black/30 p-2.5 flex flex-col gap-1`}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-mono text-gray-300 truncate">{p.name}</span>
        <span className={`flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold ${pill}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
          {isOk ? 'LIVE' : isStale ? 'STALE' : 'ERR'}
        </span>
      </div>
      <div className="text-[9px] text-gray-600 font-mono">
        {p.ts ? relativeTime(p.staleness_s) : 'no data'}
      </div>
      {isError && p.last_error && (
        <div className="text-[8px] text-red-400/70 truncate" title={p.last_error}>
          {p.last_error}
        </div>
      )}
    </div>
  )
}

export function PollerGrid({ pollers }: { pollers: PollerEntry[] }) {
  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Poller Health</h2>
      {pollers.length === 0 ? (
        <p className="text-xs text-gray-500">No heartbeats yet — pollers start within 60s.</p>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
          {pollers.map((p) => <PollerCell key={p.name} p={p} />)}
        </div>
      )}
    </section>
  )
}
