import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface PwsObs {
  station_id: string | null
  obs_time_utc: string | null
  lat: number | null
  lon: number | null
  neighborhood: string | null
  solar_radiation: number | null
  uv: number | null
  wind_dir: number | null
  humidity: number | null
  temp_f: number | null
  heat_index_f: number | null
  dewpoint_f: number | null
  wind_chill_f: number | null
  wind_speed_mph: number | null
  wind_gust_mph: number | null
  pressure_inhg: number | null
  precip_rate_in: number | null
  precip_total_in: number | null
  elev_ft: number | null
}

function windDir(deg: number | null): string {
  if (deg == null) return '—'
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
  return dirs[Math.round(deg / 22.5) % 16]
}

function fmt(v: number | null, decimals = 0): string {
  return v != null ? v.toFixed(decimals) : '—'
}

export function PWSCard() {
  const [obs, setObs] = useState<PwsObs | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/pws`, { headers: authHeaders() })
        if (res.ok) {
          const data = await res.json()
          // Empty object → no PWS configured
          if (data && data.station_id) setObs(data)
          else setObs(null)
        }
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  if (!obs) return null

  const label = obs.neighborhood || obs.station_id || 'PWS'

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-emerald-400" aria-hidden="true">sensors</span>
        PERSONAL WEATHER STATION
        <span className="ml-auto font-mono text-[9px] lg:text-[11px] text-on-surface-variant truncate max-w-[120px]">{label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-2">
        {/* Temperature */}
        <div className="border border-white/10 bg-white/[0.02] px-2 py-2 flex flex-col items-center">
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Temp</span>
          <span className="text-[15px] font-black text-on-surface">{fmt(obs.temp_f)}°</span>
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant">F</span>
        </div>

        {/* Humidity */}
        <div className="border border-white/10 bg-white/[0.02] px-2 py-2 flex flex-col items-center">
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">RH</span>
          <span className="text-[15px] font-black text-sky-400">{fmt(obs.humidity)}%</span>
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant">humid</span>
        </div>

        {/* Pressure */}
        <div className="border border-white/10 bg-white/[0.02] px-2 py-2 flex flex-col items-center">
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-widest mb-1">Press</span>
          <span className="text-[15px] font-black text-purple-400">{fmt(obs.pressure_inhg, 2)}</span>
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant">inHg</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Wind */}
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Wind</span>
          <div className="font-mono text-[11px] lg:text-[12px] text-on-surface font-bold mt-0.5">
            {windDir(obs.wind_dir)} {fmt(obs.wind_speed_mph)} mph
          </div>
          {obs.wind_gust_mph != null && obs.wind_gust_mph > 0 && (
            <div className="font-mono text-[8px] lg:text-[11px] text-amber-400/70">
              gust {fmt(obs.wind_gust_mph)} mph
            </div>
          )}
        </div>

        {/* Precipitation */}
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Precip</span>
          <div className="font-mono text-[11px] lg:text-[12px] text-on-surface font-bold mt-0.5">
            {fmt(obs.precip_rate_in, 2)}&quot;/hr
          </div>
          <div className="font-mono text-[8px] lg:text-[11px] text-sky-400/70">
            total {fmt(obs.precip_total_in, 2)}&quot;
          </div>
        </div>
      </div>

      {obs.obs_time_utc && (
        <div className="mt-2 font-mono text-[8px] lg:text-[11px] text-on-surface-variant text-right">
          {new Date(obs.obs_time_utc).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  )
}
