import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { flightCatColor } from './PirepCard'

interface Metar {
  station: string | null
  time: string | null
  temp_c: number | null
  dewpoint_c: number | null
  wind_dir: number | string | null
  wind_kt: number | null
  gust_kt: number | null
  visibility_sm: number | string | null
  altimeter: number | null
  flight_category: string | null
  raw: string | null
}

interface Taf {
  station: string | null
  issue_time: string | null
  valid_from: string | null
  valid_to: string | null
  raw: string | null
}

interface ObsData {
  metars: Metar[]
  tafs: Taf[]
}

function windDir(dir: number | string | null): string {
  if (dir == null) return '---'
  if (String(dir).toUpperCase() === 'VRB') return 'VRB'
  const n = Number(dir)
  return isNaN(n) ? String(dir) : `${String(n).padStart(3, '0')}°`
}

export function MetarCard() {
  const [data, setData] = useState<ObsData | null>(null)
  const [showTaf, setShowTaf] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/aviation/obs`, { headers: authHeaders() })
        if (res.ok) setData(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const metars = data?.metars ?? []
  const tafs = data?.tafs ?? []

  if (!data || metars.length === 0) {
    return (
      <div className="hud-panel p-4 bg-onyx-deep/40">
        <div className="label-caps mb-3 flex items-center gap-2">
          <span className="ms text-[14px] leading-none text-violet-400" aria-hidden="true">bar_chart</span>
          METAR / TAF
        </div>
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
            {data ? 'No airports in configured region bounds' : 'Awaiting first aviation weather poll (15 min)'}
          </span>
        </div>
      </div>
    )
  }

  const tafByStation = Object.fromEntries(tafs.map((t) => [t.station, t]))

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-violet-400" aria-hidden="true">bar_chart</span>
        METAR / TAF
        <span className="ml-auto font-mono text-[9px] text-gray-500">{metars.length} station{metars.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {metars.slice(0, 12).map((m, i) => {
          const taf = m.station ? tafByStation[m.station] : null
          const catCls = flightCatColor(m.flight_category)
          return (
            <div key={i} className="border border-white/5 bg-white/[0.02] p-2 hover:bg-white/[0.04] transition-colors flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-black text-on-surface tracking-tighter">{m.station ?? '????'}</span>
                  <span className={`font-mono text-[8px] font-bold px-1.5 py-0.5 rounded-sm bg-white/5 ${catCls}`}>
                    {m.flight_category ?? '--'}
                  </span>
                </div>
                <div className="font-mono text-[9px] font-bold text-amber-gold">
                  {windDir(m.wind_dir)} {m.wind_kt != null ? `${m.wind_kt}kt` : '--'}
                  {m.gust_kt != null ? ` G${m.gust_kt}` : ''}
                </div>
              </div>
              
              <div className="flex items-center justify-between gap-4 text-[9px] font-mono leading-none">
                <div className="flex gap-3">
                  <div className="flex gap-1">
                    <span className="text-on-surface-variant/40 uppercase text-[7px]">T/D</span>
                    <span className="text-on-surface font-bold">
                      {m.temp_c != null ? `${Math.round(m.temp_c)}` : '--'}/{m.dewpoint_c != null ? `${Math.round(m.dewpoint_c)}` : '--'}°
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-on-surface-variant/40 uppercase text-[7px]">VIS</span>
                    <span className="text-on-surface">{m.visibility_sm != null ? `${m.visibility_sm}` : '--'}</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-on-surface-variant/40 uppercase text-[7px]">ALT</span>
                    <span className="text-sky-400/80">{m.altimeter != null ? `${m.altimeter.toFixed(2)}` : '--'}</span>
                  </div>
                </div>

                {taf && (
                  <button
                    className={`text-[7px] font-mono px-2 py-0.5 border transition-colors uppercase tracking-widest ${showTaf === String(i) ? 'bg-violet-400 text-black border-violet-400' : 'text-violet-400/60 border-violet-400/20 hover:bg-violet-400/10'}`}
                    onClick={() => setShowTaf(showTaf === String(i) ? null : String(i))}
                  >
                    TAF
                  </button>
                )}
              </div>

              {showTaf === String(i) && taf && (
                <div className="p-1.5 bg-black/40 border border-violet-400/20 animate-in fade-in slide-in-from-top-1">
                  <p className="text-[8px] font-mono text-violet-200/60 leading-tight italic break-words">
                    {taf.raw}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
