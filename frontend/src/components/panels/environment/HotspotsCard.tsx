import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Hotspot {
  lat: number
  lon: number
  ts: string
  sat: string | null
  frp: number | null
  confidence: 'high' | 'nominal'
  dist_km: number
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** NASA FIRMS satellite detections (24 h). Hidden until there is something to show. */
export function HotspotsCard() {
  const [spots, setSpots] = useState<Hotspot[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/fire/hotspots`, { headers: authHeaders() })
        if (res.ok) setSpots(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  if (spots.length === 0) return null
  const nearest = [...spots].sort((a, b) => a.dist_km - b.dist_km)[0]

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-red-emergency" aria-hidden="true">satellite_alt</span>
        SATELLITE HOTSPOTS
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">last 24 h</span>
      </div>
      <div className="flex items-end justify-between mb-3">
        <span className="text-[18px] font-black text-on-surface tracking-tight">{spots.length} detection{spots.length === 1 ? '' : 's'}</span>
        <span className="font-mono text-[11px] text-on-surface-variant">nearest <span className="text-amber-gold">{Math.round(nearest.dist_km)} km</span></span>
      </div>
      <div className="space-y-1">
        {spots.slice(0, 6).map((s, i) => (
          <div key={`${s.lat}-${s.lon}-${i}`} className="flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[11px]">
            <span className="text-on-surface w-16">{Math.round(s.dist_km)} km</span>
            <span className="text-on-surface-variant flex-1">{s.lat.toFixed(3)}, {s.lon.toFixed(3)}</span>
            {s.frp != null && <span className="text-on-surface-variant">{Math.round(s.frp)} MW</span>}
            {s.confidence === 'high' && <span className="text-amber-gold uppercase">high</span>}
            <span className="text-on-surface-variant w-20 text-right">{ago(s.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
