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
            {data ? 'No nearby airports' : 'Awaiting first aviation weather poll (15 min)'}
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

      <div className="space-y-2">
        {metars.slice(0, 6).map((m, i) => {
          const taf = m.station ? tafByStation[m.station] : null
          const catCls = flightCatColor(m.flight_category)
          return (
            <div key={i} className="border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-[11px] font-bold text-on-surface">{m.station ?? '????'}</span>
                <span className={`font-mono text-[9px] font-bold ${catCls}`}>
                  {m.flight_category ?? '--'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 text-[8px] font-mono">
                <span className="text-gray-500">Tmp</span>
                <span className="text-on-surface">{m.temp_c != null ? `${m.temp_c}°C` : '--'}</span>
                <span className="text-gray-500">Dew</span>
                <span className="text-on-surface">{m.dewpoint_c != null ? `${m.dewpoint_c}°C` : '--'}</span>
                <span className="text-gray-500">Wind</span>
                <span className="text-on-surface col-span-3">
                  {windDir(m.wind_dir)} {m.wind_kt != null ? `${m.wind_kt}kt` : '--'}
                  {m.gust_kt != null ? ` G${m.gust_kt}` : ''}
                </span>
                <span className="text-gray-500">Vis</span>
                <span className="text-on-surface">{m.visibility_sm != null ? `${m.visibility_sm}sm` : '--'}</span>
                <span className="text-gray-500">Alt</span>
                <span className="text-on-surface">{m.altimeter != null ? `${m.altimeter.toFixed(2)}"` : '--'}</span>
              </div>
              {taf && (
                <button
                  className="mt-1.5 text-[8px] font-mono text-violet-400/60 hover:text-violet-300 text-left w-full"
                  onClick={() => setShowTaf(showTaf === String(i) ? null : String(i))}
                >
                  {showTaf === String(i) ? (
                    <span className="whitespace-pre-wrap break-all text-gray-300/70">{taf.raw}</span>
                  ) : (
                    '▶ TAF'
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
