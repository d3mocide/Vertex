import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Pirep {
  type: string
  time: string | null
  lat: number | null
  lon: number | null
  aircraft: string | null
  altitude: string | null
  turbulence: string | null
  icing: string | null
  raw: string | null
}

interface Sigmet {
  type: string
  hazard: string | null
  severity: string | null
  valid_from: string | null
  valid_to: string | null
  raw: string | null
}

interface HazardData {
  pireps: Pirep[]
  sigmets: Sigmet[]
  airmets: Sigmet[]
}

function turbColor(intensity: string | null): string {
  if (!intensity) return 'text-gray-500'
  const upper = intensity.toUpperCase()
  if (upper.includes('SEV') || upper.includes('EXTRM')) return 'text-red-400'
  if (upper.includes('MOD')) return 'text-amber-400'
  if (upper.includes('LGT') || upper.includes('SMTH')) return 'text-emerald-400'
  return 'text-gray-400'
}

function flightCatColor(cat: string | null | undefined): string {
  if (!cat) return 'text-gray-500'
  const u = cat.toUpperCase()
  if (u === 'LIFR') return 'text-fuchsia-400'
  if (u === 'IFR') return 'text-red-400'
  if (u === 'MVFR') return 'text-sky-400'
  return 'text-emerald-400'
}

export function PirepCard() {
  const [data, setData] = useState<HazardData | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/weather/aviation/hazards`, { headers: authHeaders() })
        if (res.ok) setData(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const pireps = data?.pireps ?? []
  const sigmets = data?.sigmets ?? []
  const airmets = data?.airmets ?? []
  const total = pireps.length + sigmets.length + airmets.length

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-sky-400" aria-hidden="true">flight_takeoff</span>
        AVIATION HAZARDS
        {total > 0 && (
          <span className="ml-auto font-mono text-[9px] lg:text-[11px] text-amber-400">{total} active</span>
        )}
      </div>

      {total === 0 ? (
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[9px] lg:text-[11px] text-on-surface-variant uppercase tracking-widest">
            {data ? 'No active advisories' : 'Awaiting data...'}
          </span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* SIGMETs / AIRMETs Group */}
          {(sigmets.length > 0 || airmets.length > 0) && (
            <div>
              <div className="text-[8px] lg:text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-red-500/40" />
                Weather Advisories
              </div>
              <div className="space-y-2">
                {[...sigmets.slice(0, 3), ...airmets.slice(0, 3)].map((s, i) => {
                  const isSigmet = s.type === 'SIGMET'
                  return (
                    <div key={`adv-${i}`} className={`group relative border-l-2 ${isSigmet ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'} pl-3 py-1.5`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[9px] lg:text-[11px] font-black uppercase tracking-wider ${isSigmet ? 'text-red-400' : 'text-amber-400'}`}>
                          {s.hazard ?? 'HAZARD'}
                        </span>
                        <span className="font-mono text-[8px] lg:text-[11px] text-on-surface-variant/40 uppercase">{isSigmet ? 'Sigmet' : 'Airmet'}</span>
                      </div>
                      {s.raw && (
                        <button
                          className="mt-1 text-[8px] lg:text-[11px] font-mono text-on-surface-variant/60 group-hover:text-on-surface/80 text-left w-full truncate italic"
                          onClick={() => setExpanded(expanded === `s${i}` ? null : `s${i}`)}
                        >
                          {expanded === `s${i}` ? s.raw : s.raw.slice(0, 100) + (s.raw.length > 100 ? '…' : '')}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* PIREPs Group */}
          {pireps.length > 0 && (
            <div>
              <div className="text-[8px] lg:text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-sky-500/40" />
                Pilot Reports
              </div>
              <div className="space-y-1.5">
                {pireps.slice(0, 8).map((p, i) => (
                  <div key={`pirep-${i}`} className="flex flex-col border-b border-white/5 pb-1.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] lg:text-[11px] font-black text-on-surface tracking-tighter uppercase">{p.aircraft ?? 'UNK'}</span>
                        <span className="text-[9px] lg:text-[11px] font-mono text-sky-400/60">FL{p.altitude ?? '??'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.turbulence && p.turbulence !== 'NONE' && (
                          <span className={`text-[7px] lg:text-[11px] font-black px-1 rounded-sm bg-white/5 uppercase ${turbColor(p.turbulence)}`}>
                            {p.turbulence}
                          </span>
                        )}
                        {p.icing && p.icing !== 'NONE' && (
                          <span className="text-[7px] lg:text-[11px] font-black px-1 rounded-sm bg-cyan-400/10 text-cyan-400 uppercase">
                            ICG {p.icing}
                          </span>
                        )}
                      </div>
                    </div>
                    {p.raw && (
                      <button
                        className="mt-0.5 text-[8px] lg:text-[11px] font-mono text-on-surface-variant/40 hover:text-on-surface-variant/80 text-left w-full truncate"
                        onClick={() => setExpanded(expanded === `p${i}` ? null : `p${i}`)}
                      >
                        {expanded === `p${i}` ? p.raw : p.raw.slice(0, 120)}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { flightCatColor }
