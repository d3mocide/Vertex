import { useState } from 'react'
import { useCivicStore } from '../../../store'
import type { NwrRiver } from '../../../storeTypes'

const RIVERS_SHOWN = 8

const fmtFt = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} ft`)
const fmtCfs = (v: number | null | undefined) => (v == null ? '' : `${v.toLocaleString()} cfs`)

/** How the spoken reading compares with NOAA's own, in words a person can act on. */
function verdict(r: NwrRiver): { label: string; tone: 'ok' | 'warn' | 'dim' } {
  switch (r.status) {
    case 'match': return { label: 'matches NOAA', tone: 'ok' }
    case 'close': return { label: `close to NOAA ${fmtFt(r.official?.stage_ft)}`, tone: 'warn' }
    case 'differs': return { label: `NOAA says ${fmtFt(r.official?.stage_ft)}`, tone: 'warn' }
    case 'radio_missing': return { label: `not read on air · NOAA ${fmtFt(r.official?.stage_ft)}`, tone: 'warn' }
    case 'no_data': return { label: 'no data anywhere', tone: 'dim' }
    default: return { label: 'unchecked', tone: 'dim' }
  }
}

// Worst first: what disagrees or is missing is the reason to look at this card at all.
const ATTENTION: Record<NwrRiver['status'], number> = { differs: 0, radio_missing: 1, close: 2, unchecked: 3, no_data: 4, match: 5 }

/** What the Weather Radio script says that the alert feeds do not: river gauges (including ones outside the map,
 *  each checked against NOAA's own reading), the Columbia River Bar and the hourly observations. */
export function NwrBroadcastCard() {
  const data = useCivicStore((s) => s.nwrBroadcast)
  const [allRivers, setAllRivers] = useState(false)

  if (!data?.enabled) return null
  const rivers = [...data.rivers].sort((a, b) => ATTENTION[a.status] - ATTENTION[b.status])
  const stations = data.observations.stations
  const bar = data.marine.bar
  const buoy = data.marine.buoy
  if (rivers.length === 0 && stations.length === 0 && !bar && !buoy) return null
  const shown = allRivers ? rivers : rivers.slice(0, RIVERS_SHOWN)

  return (
    <section className="hud-panel bg-onyx-deep/40 p-4" aria-label="Heard on Weather Radio">
      <div className="label-caps mb-1 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">graphic_eq</span>
        HEARD ON WEATHER RADIO
      </div>
      <p className="text-[11px] text-on-surface-variant mb-3">Read from the broadcast by speech-to-text, so a number can be misheard. NOAA's own reading is shown where they disagree.</p>

      {rivers.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">River gauges</div>
          <ul className="stack-y-1">
            {shown.map((r) => {
              const v = verdict(r)
              return (
                <li key={r.name} className="border border-white/10 bg-white/2 px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-on-surface truncate flex-1">{r.name}</span>
                    {!r.in_vertex && (
                      <span className="text-[10px] font-bold uppercase tracking-wider border border-outline-variant text-on-surface-variant px-1"
                            title="Not one of the gauges on Vertex's own map">radio only</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 font-mono text-[11px]">
                    <span className="text-on-surface">{r.missing ? 'report missing' : fmtFt(r.stage_ft)}</span>
                    <span className="text-on-surface-variant">{fmtCfs(r.flow_cfs)}</span>
                    <span className={`ml-auto ${v.tone === 'ok' ? 'text-green-ais' : v.tone === 'warn' ? 'text-amber-gold' : 'text-on-surface-variant'}`}>{v.label}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {rivers.length > RIVERS_SHOWN && (
            <button type="button" className="mt-2 text-[11px] font-mono uppercase tracking-widest text-amber-gold" onClick={() => setAllRivers((v) => !v)}>
              {allRivers ? 'show fewer' : `show all ${rivers.length}`}
            </button>
          )}
        </div>
      )}

      {(bar || buoy) && (
        <div className="mb-4">
          <div className="text-[11px] font-mono uppercase tracking-widest text-on-surface-variant mb-1">Coast</div>
          {bar && (
            <p className="font-mono text-[12px] text-on-surface">
              Columbia River Bar · seas {bar.seas_ft[0]}–{bar.seas_ft[1]} ft <span className="text-on-surface-variant">{bar.note}</span>
            </p>
          )}
          {buoy && (
            <p className="font-mono text-[12px] text-on-surface">
              {buoy.name} · wind {buoy.wind_dir ?? '—'} {buoy.wind_kt} kt · seas {buoy.seas_ft} ft at {buoy.period_s} s
            </p>
          )}
        </div>
      )}

      {stations.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-mono uppercase tracking-widest text-on-surface-variant">
            Observations · {data.observations.hour} · {stations.length} places
          </summary>
          <ul className="mt-2 stack-y-1">
            {stations.map((s) => (
              <li key={s.place} className="flex items-center gap-3 border border-white/10 bg-white/2 px-3 py-1">
                <span className="text-[12px] text-on-surface flex-1 truncate">{s.place}</span>
                <span className="text-[11px] text-on-surface-variant truncate">{s.sky}</span>
                <span className="font-mono text-[12px] text-amber-gold w-10 text-right">{s.temp_f}°</span>
                <span className="font-mono text-[11px] text-on-surface-variant w-20 text-right">
                  {s.wind_mph === 0 ? 'calm' : s.wind_mph != null ? `${s.wind_dir ?? ''} ${s.wind_mph}${s.gust_mph ? `g${s.gust_mph}` : ''}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
