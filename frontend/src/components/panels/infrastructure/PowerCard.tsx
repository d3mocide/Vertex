import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { formatAge, useFeedFreshness } from '../../common/FeedAge'

interface Near { utility: string; county: string; meters_out: number; meters_served: number | null; dist_km: number | null }
interface Outages { near: Near[] }

/**
 * Power outages: what is out near us first (utility, county, how many meters, how far), with the
 * statewide/metro totals as context. The map layer ("Power Outages" in Settings) draws the areas.
 */
export function PowerCard({ statewide, metro, pge, pacific }: { statewide: number; metro: number; pge: number; pacific: number }) {
  const [near, setNear] = useState<Near[]>([])
  const age = useFeedFreshness('utility:oregon')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/utilities/outages`, { headers: authHeaders() })
        if (res.ok) setNear(((await res.json()) as Outages).near ?? [])
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const nearTotal = near.reduce((n, o) => n + o.meters_out, 0)
  const stale = age.state === 'dead'

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
          <span className="w-2 h-2 rounded-full bg-green-ais shrink-0" />
          <span className="text-[12px] text-on-surface">No outages within 30 km</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[12px] text-amber-gold font-bold">{nearTotal} meters out near you</div>
          {near.slice(0, 5).map((o, i) => (
            <div key={`${o.county}-${i}`} className="flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[11px]">
              <span className="text-on-surface flex-1 truncate">{o.utility}</span>
              <span className="text-on-surface-variant">{o.county}</span>
              <span className="text-amber-gold w-16 text-right">{o.meters_out} out</span>
              <span className="text-on-surface-variant w-12 text-right">{o.dist_km != null ? `${Math.round(o.dist_km)} km` : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-white/5 font-mono text-[11px] text-on-surface-variant">
        Oregon: {statewide} meters out · metro {metro} · PGE {pge} · Pacific Power {pacific}
      </div>
    </div>
  )
}
