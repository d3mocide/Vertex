import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { useCivicStore } from '../../../store'
import type { TransitRouteDetail, TransitRouteSummary } from '../../../storeTypes'

interface StopInfo { id: string; feed: string; name: string; routes: TransitRouteSummary[] }

/** GTFS route_type, including the extended 100-1799 ranges, as a rider would say it. */
export function modeName(type: number | null): string {
  if (type === null) return 'Route'
  if (type === 0 || (type >= 900 && type < 1000)) return 'Tram'
  if (type === 1 || (type >= 400 && type < 500)) return 'Metro'
  if (type === 2 || (type >= 100 && type < 200)) return 'Rail'
  if (type === 3 || (type >= 700 && type < 800)) return 'Bus'
  return 'Transit'
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), signal })
    return res.ok ? await res.json() as T : null
  } catch { return null }
}

function RouteBadge({ route }: { route: TransitRouteSummary }) {
  // The agency's own colours: data, not design tokens.
  return (
    <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 min-w-8 text-center shrink-0"
      style={{ backgroundColor: route.color ?? undefined, color: route.text_color ?? undefined }}>
      {route.short_name || route.route_id}
    </span>
  )
}

export function TransitBrowser({ agencyNames }: { agencyNames: Record<string, string> }) {
  const [routes, setRoutes] = useState<TransitRouteSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [feed, setFeed] = useState('all')
  const [loadingRoute, setLoadingRoute] = useState(false)
  const [direction, setDirection] = useState(0)
  const [stop, setStop] = useState<StopInfo | null>(null)
  const detail = useCivicStore(s => s.transitBrowse)
  const stopId = useCivicStore(s => s.transitBrowseStop)
  const setBrowse = useCivicStore(s => s.setTransitBrowse)
  const setActiveTab = useCivicStore(s => s.setActiveTab)

  useEffect(() => {
    const controller = new AbortController()
    getJson<TransitRouteSummary[]>('/transit/route-list', controller.signal).then(list => {
      if (controller.signal.aborted) return
      if (list) setRoutes(list); else setFailed(true)
    })
    return () => controller.abort()
  }, [])

  const feeds = useMemo(() => [...new Set((routes ?? []).map(r => r.feed))], [routes])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (routes ?? []).filter(r => (feed === 'all' || r.feed === feed)
      && (!q || `${r.short_name} ${r.long_name}`.toLowerCase().includes(q)))
  }, [routes, query, feed])

  const openRoute = async (r: TransitRouteSummary, keepStop: string | null = null) => {
    setLoadingRoute(true); setDirection(0); setStop(null)
    const loaded = await getJson<TransitRouteDetail>(`/transit/route/${encodeURIComponent(r.feed)}/${encodeURIComponent(r.route_id)}`)
    setLoadingRoute(false)
    if (loaded) setBrowse(loaded, keepStop)
  }

  const openStop = async (feedName: string, id: string) => {
    setBrowse(detail, id)
    setStop(await getJson<StopInfo>(`/transit/stop/${encodeURIComponent(feedName)}/${encodeURIComponent(id)}`))
  }

  if (failed) return <p className="text-[12px] text-on-surface-variant">Routes could not be loaded.</p>
  if (!routes) return <p className="text-[12px] text-on-surface-variant">Loading routes…</p>
  if (!routes.length) return <p className="text-[12px] text-on-surface-variant">No routes have been published for this area yet.</p>

  const current = detail?.directions[direction] ?? detail?.directions[0]
  return (
    <div className="stack-y-3">
      <span className="label-caps block">Routes and stops</span>
      <div className="flex gap-2">
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Route number or name"
          aria-label="Filter routes"
          className="flex-1 min-w-0 bg-onyx-deep border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] px-3 py-1.5 focus:outline-hidden focus:border-amber-gold/60 transition-colors" />
        {feeds.length > 1 && (
          <select value={feed} onChange={e => setFeed(e.target.value)} aria-label="Agency"
            className="bg-onyx-deep border border-white/10 text-on-surface text-[11px] px-2 py-1.5 focus:outline-hidden focus:border-amber-gold/60">
            <option value="all">All agencies</option>
            {feeds.map(f => <option key={f} value={f}>{agencyNames[f + '-transit'] ?? f}</option>)}
          </select>
        )}
      </div>

      <ul className="max-h-56 overflow-y-auto border border-white/10 bg-onyx-deep/40" aria-label="Routes">
        {shown.map(r => (
          <li key={r.id}>
            <button type="button" aria-pressed={detail?.route.id === r.id} onClick={() => openRoute(r)}
              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 border-b border-white/5 hover:bg-white/5 focus:outline-hidden focus:bg-white/5 ${detail?.route.id === r.id ? 'bg-amber-gold/10' : ''}`}>
              <RouteBadge route={r} />
              <span className="text-[12px] text-on-surface truncate flex-1">{r.long_name || `Route ${r.short_name}`}</span>
              <span className="label-caps shrink-0">{modeName(r.type)}</span>
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-3 text-[12px] text-on-surface-variant">No route matches.</li>}
      </ul>

      {loadingRoute && <p className="text-[12px] text-on-surface-variant">Loading route…</p>}
      {detail && !loadingRoute && (
        <div className="border border-white/10 bg-onyx-deep/40 p-3 stack-y-3">
          <div className="flex items-center gap-2">
            <RouteBadge route={detail.route} />
            <span className="text-[13px] text-on-surface font-bold truncate flex-1">{detail.route.long_name || `Route ${detail.route.short_name}`}</span>
            <button type="button" className="btn-ghost px-2 py-1" onClick={() => setActiveTab('safety')}>
              <span className="ms text-[14px] leading-none mr-1" aria-hidden="true">map</span>Show on map
            </button>
            <button type="button" className="btn-ghost px-2 py-1" aria-label="Clear route" onClick={() => { setBrowse(null); setStop(null) }}>
              <span className="ms text-[14px] leading-none" aria-hidden="true">close</span>
            </button>
          </div>
          {detail.directions.length > 1 && (
            <div className="flex gap-2" role="tablist" aria-label="Direction">
              {detail.directions.map((d, i) => (
                <button key={i} type="button" role="tab" aria-selected={i === direction} aria-pressed={i === direction}
                  className="btn-ghost px-2 py-1 truncate max-w-[48%]" onClick={() => setDirection(i)}>
                  <span className="truncate">To {d.headsign || `direction ${i + 1}`}</span>
                </button>
              ))}
            </div>
          )}
          {current ? (
            <ol className="max-h-64 overflow-y-auto" aria-label="Stops">
              {current.stops.map((s, i) => (
                <li key={s.id}>
                  <button type="button" aria-pressed={stopId === s.id} onClick={() => openStop(detail.route.feed, s.id)}
                    className={`w-full text-left flex items-center gap-2 px-2 py-1 hover:bg-white/5 focus:outline-hidden focus:bg-white/5 ${stopId === s.id ? 'bg-amber-gold/10' : ''}`}>
                    <span className="font-mono text-[10px] text-on-surface-variant w-6 text-right shrink-0">{i + 1}</span>
                    <span className={`text-[12px] truncate ${stopId === s.id ? 'text-amber-gold' : 'text-on-surface'}`}>{s.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="text-[12px] text-on-surface-variant">This route's stops are not published.</p>}
          {stop && stop.id === stopId && (
            <div className="stack-y-2 border-t border-white/10 pt-3">
              <span className="label-caps block">Routes at {stop.name}</span>
              <div className="flex flex-wrap gap-2">
                {stop.routes.map(r => (
                  <button key={r.id} type="button" className="flex items-center gap-1 border border-white/10 px-1 py-1 hover:border-amber-gold/60"
                    aria-label={`Open ${r.long_name || r.short_name}`} onClick={() => openRoute(r, stop.id)}>
                    <RouteBadge route={r} />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-on-surface-variant">Stops and routes come from the published schedule; arrival times are not shown.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
