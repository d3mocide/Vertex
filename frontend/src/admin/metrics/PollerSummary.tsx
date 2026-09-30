import { useState } from 'react'
import type { PollerEntry } from './types'

function ago(s: number): string {
  if (s < 5) return 'just now'
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function Row({ p }: { p: PollerEntry }) {
  const bad = p.status !== 'ok'
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 border text-[11px] font-mono min-w-0 ${
      p.status === 'error' ? 'border-red-emergency/40' : p.status === 'stale' ? 'border-amber-gold/40' : 'border-white/5'}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'error' ? 'bg-red-emergency' : p.status === 'stale' ? 'bg-amber-gold' : 'bg-green-ais'}`} aria-hidden="true" />
      <span className="text-on-surface truncate">{p.name}</span>
      <span className="ml-auto text-on-surface-variant shrink-0">
        {bad && p.last_error ? <span className="text-red-emergency" title={p.last_error}>{p.last_error.slice(0, 40)}</span> : ago(p.staleness_s)}
      </span>
      {p.error_count > 0 && <span className="text-red-emergency shrink-0">×{p.error_count}</span>}
    </div>
  )
}

/**
 * The pollers that fetch and decode each data source. When they are all healthy this is one line;
 * anything stale or failing is listed, and the full roster is one click away.
 */
export function PollerSummary({ pollers }: { pollers: PollerEntry[] }) {
  const [showAll, setShowAll] = useState(false)
  if (pollers.length === 0) {
    return (
      <section>
        <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">Pollers</h2>
        <p className="text-xs text-on-surface-variant">No heartbeats yet — pollers start within 60s.</p>
      </section>
    )
  }
  const ok = pollers.filter((p) => p.status === 'ok').length
  const problems = pollers.filter((p) => p.status !== 'ok')

  return (
    <section className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant">
        Pollers
        <span className={`ml-2 normal-case tracking-normal font-normal ${problems.length ? 'text-amber-gold' : ''}`}>
          {ok} of {pollers.length} healthy{problems.length ? ` · ${problems.length} need attention` : ''}
        </span>
      </h2>
      {problems.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">{problems.map((p) => <Row key={p.name} p={p} />)}</div>
      )}
      <button type="button" onClick={() => setShowAll((v) => !v)}
        className="text-[11px] font-bold uppercase tracking-widest text-amber-gold hover:underline">
        {showAll ? 'Hide' : 'Show'} all {pollers.length} pollers {showAll ? '▴' : '▾'}
      </button>
      {showAll && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5">
          {pollers.map((p) => <Row key={p.name} p={p} />)}
        </div>
      )}
    </section>
  )
}
