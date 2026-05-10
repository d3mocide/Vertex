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
          <span className="ml-auto font-mono text-[9px] text-amber-400">{total} active</span>
        )}
      </div>

      {total === 0 ? (
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
            {data ? 'No PIREPs or advisories in region' : 'Awaiting first aviation weather poll (15 min)'}
          </span>
        </div>
      ) : (
        <div className="space-y-2">
          {/* SIGMETs */}
          {sigmets.slice(0, 2).map((s, i) => (
            <div key={`sigmet-${i}`} className="border border-red-500/30 bg-red-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider">SIGMET — {s.hazard ?? 'Unknown'}</span>
                <span className="font-mono text-[8px] text-red-300/60">{s.severity}</span>
              </div>
              {s.raw && (
                <button
                  className="mt-1 text-[8px] font-mono text-on-surface-variant/60 hover:text-on-surface/80 text-left w-full truncate"
                  onClick={() => setExpanded(expanded === `s${i}` ? null : `s${i}`)}
                >
                  {expanded === `s${i}` ? s.raw : s.raw.slice(0, 80) + (s.raw.length > 80 ? '…' : '')}
                </button>
              )}
            </div>
          ))}

          {/* AIRMETs */}
          {airmets.slice(0, 3).map((a, i) => (
            <div key={`airmet-${i}`} className="border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wider">AIRMET — {a.hazard ?? 'Unknown'}</span>
              </div>
              {a.raw && (
                <button
                  className="mt-1 text-[8px] font-mono text-on-surface-variant/60 hover:text-on-surface/80 text-left w-full truncate"
                  onClick={() => setExpanded(expanded === `a${i}` ? null : `a${i}`)}
                >
                  {expanded === `a${i}` ? a.raw : a.raw.slice(0, 80) + (a.raw.length > 80 ? '…' : '')}
                </button>
              )}
            </div>
          ))}

          {/* PIREPs */}
          {pireps.slice(0, 5).map((p, i) => (
            <div key={`pirep-${i}`} className="border border-white/10 bg-white/[0.02] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-mono text-sky-300/80">
                  {p.aircraft ?? p.type} @ FL{p.altitude ?? '???'}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {p.turbulence && p.turbulence !== 'NONE' && (
                    <span className={`text-[8px] font-mono ${turbColor(p.turbulence)}`}>
                      TURB {p.turbulence}
                    </span>
                  )}
                  {p.icing && p.icing !== 'NONE' && (
                    <span className="text-[8px] font-mono text-cyan-400">ICG {p.icing}</span>
                  )}
                </div>
              </div>
              {p.raw && (
                <button
                  className="mt-1 text-[8px] font-mono text-on-surface-variant/60 hover:text-on-surface/80 text-left w-full"
                  onClick={() => setExpanded(expanded === `p${i}` ? null : `p${i}`)}
                >
                  {expanded === `p${i}` ? p.raw : p.raw.slice(0, 100) + (p.raw.length > 100 ? '…' : '')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export { flightCatColor }
