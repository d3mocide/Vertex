import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Hour {
  ts: string
  temp_f: number | null
  pop: number | null
  wind_mph: number | null
  wind_dir: string
  short: string
}
interface Period {
  name: string
  temp_f: number | null
  is_day: boolean
  pop: number | null
  short: string
}
interface Forecast { hourly: Hour[]; periods: Period[]; updated: string | null }

const hourLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase()

// Below this the chance of rain is not worth a line of the display.
const POP_SHOWN = 20
const RAINY = 50

/** NWS hourly (next 24 h) and the next few day/night periods. Hidden until it loads. */
export function ForecastStrip() {
  const [fc, setFc] = useState<Forecast | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/forecast`, { headers: authHeaders() })
        if (res.ok) setFc(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  if (!fc || (fc.hourly.length === 0 && fc.periods.length === 0)) return null

  return (
    <div className="space-y-3">
      {fc.hourly.length > 0 && (
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Next 24 hours</div>
          <div className="flex border border-white/10 bg-white/[0.02]">
            {/* Row labels stay put while the hours scroll. */}
            <div className="shrink-0 w-11 px-1 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-on-surface-variant/70 border-r border-white/10" aria-hidden="true">
              <div className="text-[11px] invisible">0</div>
              <div className="mt-1 h-[21px] leading-[21px]">°F</div>
              <div className="mt-1 h-4 leading-4">rain</div>
              <div className="leading-4">mph</div>
            </div>
          <div className="flex overflow-x-auto no-scrollbar flex-1 min-w-0" role="list" aria-label="Hourly forecast">
            {fc.hourly.map((h) => (
              <div key={h.ts} role="listitem" className="shrink-0 w-[52px] px-1 py-2 text-center border-r border-white/5 last:border-r-0">
                <div className="font-mono text-[11px] text-on-surface-variant">{hourLabel(h.ts)}</div>
                <div className="font-mono text-[14px] font-bold text-on-surface mt-1">{h.temp_f != null ? `${h.temp_f}°` : '—'}</div>
                <div className={`font-mono text-[11px] mt-1 h-4 ${h.pop != null && h.pop >= RAINY ? 'text-amber-gold font-bold' : 'text-on-surface-variant'}`}>
                  {h.pop != null && h.pop >= POP_SHOWN ? `${h.pop}%` : ''}
                </div>
                <div className="font-mono text-[11px] text-on-surface-variant">{h.wind_mph != null ? h.wind_mph : '—'}</div>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {fc.periods.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {fc.periods.slice(0, 4).map((p, i) => (
            <div key={p.name} className={`${i >= 2 ? 'hidden sm:flex' : 'flex'} items-center gap-3 border border-white/10 bg-white/[0.02] px-3 py-1.5`}>
              <span className="ms text-[16px] leading-none text-on-surface-variant" aria-hidden="true">{p.is_day ? 'wb_sunny' : 'bedtime'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold text-on-surface truncate">{p.name}</div>
                <div className="text-[11px] text-on-surface-variant truncate">{p.short}</div>
              </div>
              {p.pop != null && p.pop >= POP_SHOWN && (
                <span className={`font-mono text-[11px] ${p.pop >= RAINY ? 'text-amber-gold font-bold' : 'text-on-surface-variant'}`}>{p.pop}%</span>
              )}
              <span className="font-mono text-[14px] font-bold text-amber-gold w-10 text-right">{p.temp_f != null ? `${p.temp_f}°` : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
