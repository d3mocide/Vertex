import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import type { TransitAlert } from '../../../storeTypes'

const SHOWN = 3

function since(seconds: number | null): string {
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** One agency service alert: what it says, which routes it concerns and where the agency explains more. */
export function TransitAlertRow({ alert }: { alert: TransitAlert }) {
  return (
    <div className="border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 stack-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {alert.effect && <span className="text-[10px] font-bold uppercase tracking-wider border border-amber-gold/60 text-amber-gold px-1">{alert.effect}</span>}
        {alert.agency_wide && <span className="label-caps">All routes</span>}
        {(alert.route_labels ?? []).slice(0, 6).map(label => <span key={label} className="font-mono text-[11px] text-on-surface">{label}</span>)}
        {alert.start && <span className="font-mono text-[10px] text-on-surface-variant ml-auto">since {since(alert.start)}</span>}
      </div>
      <p className="text-[12px] text-on-surface">{alert.header}</p>
      {alert.description && <p className="text-[11px] text-on-surface-variant">{alert.description}</p>}
      {alert.url && <a href={alert.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-gold hover:underline">Agency details</a>}
    </div>
  )
}

/** Active service alerts for the monitored area, newest first; the rest sit behind a toggle. */
export function TransitAlerts() {
  const [alerts, setAlerts] = useState<TransitAlert[]>([])
  const [all, setAll] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const load = () => fetch(`${API_BASE}/transit/alerts`, { headers: authHeaders(), signal: controller.signal })
      .then(r => r.ok ? r.json() as Promise<TransitAlert[]> : [])
      .then(list => { if (!controller.signal.aborted) setAlerts(list) })
      .catch(() => { /* alerts are an extra: keep the last list */ })
    load()
    const timer = setInterval(load, 5 * 60 * 1000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  if (!alerts.length) return null
  const rows = all ? alerts : alerts.slice(0, SHOWN)
  return (
    <div className="stack-y-2">
      <span className="label-caps block">Service alerts <span className="font-mono text-amber-gold">{alerts.length}</span></span>
      {rows.map(a => <TransitAlertRow key={`${a.feed}:${a.id}`} alert={a} />)}
      {alerts.length > SHOWN && (
        <button type="button" className="btn-ghost px-2 py-1" aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${alerts.length}`}
        </button>
      )}
    </div>
  )
}
