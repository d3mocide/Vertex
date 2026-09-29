import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Zone {
  zone: string
  danger: number
  label: string
  dist_km: number
}
interface Danger { home: Zone | null; nearby: Zone[] }

// Same signal colours as the map layer: green nominal, gold caution, orange serious, red extreme.
const TONE: Record<number, string> = {
  1: 'text-green-ais',
  2: 'text-amber-gold',
  3: 'text-amber-p25',
  4: 'text-red-emergency',
}

/** ODF's official fire danger for the forestland around us. Hidden until data arrives. */
export function FireDangerCard() {
  const [data, setData] = useState<Danger | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/fire/danger`, { headers: authHeaders() })
        if (res.ok) setData(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const zones = data ? (data.home ? [data.home] : data.nearby) : []
  if (zones.length === 0) return null
  const top = zones.reduce((a, b) => (b.danger > a.danger ? b : a))

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-p25" aria-hidden="true">whatshot</span>
        FIRE DANGER · ODF
      </div>
      <div className="flex items-end justify-between mb-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">
            {data?.home ? 'Your zone' : 'Highest nearby'}
          </span>
          <span className={`text-[18px] font-black tracking-tight ${TONE[top.danger] ?? 'text-on-surface'}`}>{top.label}</span>
        </div>
        <span className="font-mono text-[11px] text-on-surface-variant">Forest protection zones</span>
      </div>
      <div className="space-y-1">
        {zones.map((z) => (
          <div key={z.zone} className="flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[11px]">
            <span className="text-on-surface w-14">{z.zone}</span>
            <span className={`flex-1 font-bold uppercase ${TONE[z.danger] ?? ''}`}>{z.label}</span>
            <span className="text-on-surface-variant">{z.dist_km > 0 ? `${Math.round(z.dist_km)} km` : 'inside'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
