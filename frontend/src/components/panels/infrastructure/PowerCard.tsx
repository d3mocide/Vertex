import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { formatAge, useFeedFreshness } from '../../common/FeedAge'

interface Near { utility: string; county: string; meters_out: number; meters_served: number | null; dist_km: number | null; context?: string[] }
interface Outages {
  near: Near[]
  updated: string | null
  near_radius_km?: number
  coverage?: string[]
  utilities?: { id: string; name: string; state: string; coverage: string; meters_out: number; nearby_meters_out: number; attribution?: string }[]
}

/**
 * Power outages: what is out near us first (utility, county, how many meters, how far), with the
 * statewide/metro totals as context. The map layer ("Power Outages" in Settings) draws the areas.
 */
export function PowerCard() {
  const [data, setData] = useState<Outages | null>(null)
  const [failed, setFailed] = useState(false)
  const age = useFeedFreshness('utility:outages')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/utilities/outages`, { headers: authHeaders() })
        if (!res.ok) throw new Error('Outage request failed')
        setData(await res.json() as Outages)
        setFailed(false)
      } catch { setFailed(true) }
    }
    load()
    const t = setInterval(load, 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const near = data?.near ?? []
  const nearTotal = near.reduce((n, o) => n + o.meters_out, 0)
  const stale = age.state === 'dead' || age.state === 'stale'
  const current = !!data?.updated && age.state === 'fresh' && !failed

  return (
    <div className="hud-panel p-3">
      <div className="label-caps mb-2 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">bolt</span>
        POWER
        <span className={`ml-auto font-mono text-[11px] normal-case tracking-normal ${stale ? 'text-red-emergency' : 'text-on-surface-variant'}`}>
          {age.ageS == null ? 'no data yet' : `updated ${formatAge(age.ageS)}`}
        </span>
      </div>

      {near.length === 0 ? (
        <div className="flex items-center gap-2 py-1">
          <span className={`w-2 h-2 rounded-full shrink-0 ${current ? 'bg-green-ais' : 'bg-amber-gold'}`} />
          <span className="text-[12px] text-on-surface">{current ? `No reported outages within ${data?.near_radius_km ?? 30} km in covered areas` : 'Nearby outage status unavailable'}</span>
        </div>
      ) : (
        <div className="stack-y-1.5">
          <div className="text-[12px] text-amber-gold font-bold">{nearTotal} meters out near you</div>
          {near.slice(0, 5).map((o, i) => (
            <div key={`${o.county}-${i}`} className="border border-white/10 bg-white/2 px-3 py-1.5 font-mono text-[11px]">
              <div className="flex items-center gap-3">
                <span className="text-on-surface flex-1 truncate">{o.utility}</span>
                <span className="text-on-surface-variant">{o.county}</span>
                <span className="text-amber-gold w-16 text-right">{o.meters_out} out</span>
                <span className="text-on-surface-variant w-12 text-right">{o.dist_km != null ? `${Math.round(o.dist_km)} km` : ''}</span>
              </div>
              {/* The utility's own cause is not public; this is what else is going on nearby. */}
              <div className="mt-0.5 text-on-surface-variant">
                {o.context && o.context.length > 0
                  ? <><span className="uppercase tracking-widest">Context </span><span className="text-on-surface">{o.context.join(' · ')}</span></>
                  : 'No cause published · nothing unusual nearby'}
              </div>
            </div>
          ))}
        </div>
      )}

      {(failed || stale) && <p className="mt-2 text-[11px] text-amber-gold">Updates are unavailable or overdue. Showing last known reports.</p>}
      <div className="mt-2 pt-2 border-t border-white/5 font-mono text-[11px] text-on-surface-variant stack-y-1">
        <div>Reported coverage: {data?.coverage?.join(', ') || 'unreported'}</div>
        <details>
          <summary className="cursor-pointer">Utility totals · {data?.utilities?.length ?? 0} reporting utilities</summary>
          <div className="mt-1 stack-y-1">
            {(data?.utilities ?? []).map((utility) => <div key={utility.id}>{utility.name} · {utility.state} · {utility.meters_out.toLocaleString()} meters out{utility.attribution ? ` · ${utility.attribution}` : ''}</div>)}
          </div>
        </details>
        {near.some((o) => /portland general/i.test(o.utility)) && (
          <a href="https://portlandgeneral.com/outages" target="_blank" rel="noreferrer noopener" className="inline-block uppercase tracking-widest text-amber-gold hover:text-white">
            Cause &amp; restoration time: PGE outage map ↗
          </a>
        )}
      </div>
    </div>
  )
}
