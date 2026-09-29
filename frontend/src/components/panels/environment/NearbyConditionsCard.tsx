import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface NwsStation {
  id: string
  name: string
  temp_f: number | null
  wind_mph: number | null
  wind_gust_mph: number | null
  wind_dir: string
  condition: string
  humidity: number | null
}

interface RwisStation {
  id: number
  name: string
  route: string | null
  dist_km: number
  temp_f: number | null
  surface_f: number | null
  wind_mph: number | null
  gust_mph: number | null
  visibility_m: number | null
  precip: string | null
  updated: string | null
}

// Pavement at or near freezing is the thing worth flagging on a road sensor.
const ICE_SURFACE_F = 34
// The stations cap visibility near 2 km, so "reduced" means well under that.
const LOW_VIS_M = 800
const RWIS_SHOWN = 8

const fmt = (v: number | null, unit = '') => (v == null ? '—' : `${Math.round(v)}${unit}`)

export function NearbyConditionsCard() {
  const [stations, setStations] = useState<NwsStation[]>([])
  const [rwis, setRwis] = useState<RwisStation[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const [s, r] = await Promise.all([
          fetch(`${API_BASE}/weather/stations`, { headers: authHeaders() }),
          fetch(`${API_BASE}/weather/rwis`, { headers: authHeaders() }),
        ])
        if (s.ok) setStations(await s.json())
        if (r.ok) setRwis(await r.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  if (stations.length === 0 && rwis.length === 0) return null

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">thermostat</span>
        NEARBY CONDITIONS
      </div>

      {stations.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Airport stations</div>
          <div className="space-y-1">
            {stations.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-1.5">
                <span className="font-mono text-[12px] font-bold text-on-surface w-11 shrink-0">{s.id}</span>
                <span className="text-[11px] text-on-surface-variant truncate flex-1">{s.condition || s.name}</span>
                <span className="font-mono text-[12px] text-amber-gold w-10 text-right">{fmt(s.temp_f, '°')}</span>
                <span className="font-mono text-[11px] text-on-surface-variant w-20 text-right">
                  {s.wind_mph ? `${s.wind_dir} ${fmt(s.wind_mph)}${s.wind_gust_mph ? `g${fmt(s.wind_gust_mph)}` : ''}` : 'calm'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rwis.length > 0 && (
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Road weather · ODOT</div>
          <div className="space-y-1">
            {rwis.slice(0, RWIS_SHOWN).map((r) => {
              const icy = r.surface_f != null && r.surface_f <= ICE_SURFACE_F
              const lowVis = r.visibility_m != null && r.visibility_m < LOW_VIS_M
              return (
                <div key={`${r.id}-${r.name}`} className="border border-white/10 bg-white/[0.02] px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-on-surface truncate flex-1">{r.name}</span>
                    {icy && <span className="text-[10px] font-bold uppercase tracking-wider border border-amber-gold/60 text-amber-gold px-1">Ice risk</span>}
                    {lowVis && <span className="text-[10px] font-bold uppercase tracking-wider border border-amber-gold/60 text-amber-gold px-1">Low vis</span>}
                    {r.precip && <span className="text-[10px] uppercase tracking-wider text-on-surface-variant">{r.precip}</span>}
                    <span className="font-mono text-[11px] text-on-surface-variant shrink-0">{fmt(r.dist_km, ' km')}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-0.5 font-mono text-[11px] text-on-surface-variant">
                    <span>Air <span className="text-amber-gold">{fmt(r.temp_f, '°')}</span></span>
                    <span>Road <span className={icy ? 'text-amber-gold' : 'text-on-surface'}>{fmt(r.surface_f, '°')}</span></span>
                    <span>Wind <span className="text-on-surface">{fmt(r.wind_mph)}{r.gust_mph && r.gust_mph > (r.wind_mph ?? 0) ? `g${fmt(r.gust_mph)}` : ''}</span></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
