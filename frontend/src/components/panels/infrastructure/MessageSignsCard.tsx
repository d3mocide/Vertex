import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'

interface Sign {
  id: number
  name: string
  route: string
  dist_km: number
  page1: string[]
  page2: string[]
  text: string
  kind: 'message' | 'travel'
}

/** What ODOT's freeway signs are telling drivers right now. Messages first; travel times stay small. */
export function MessageSignsCard() {
  const [signs, setSigns] = useState<Sign[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/traffic/signs`, { headers: authHeaders() })
        if (res.ok) setSigns(await res.json())
      } catch { /* non-fatal */ }
    }
    load()
    const t = setInterval(load, 2 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const messages = signs.filter((s) => s.kind === 'message')
  const travel = signs.filter((s) => s.kind === 'travel')
  if (messages.length === 0 && travel.length === 0) return null

  return (
    <div className="hud-panel p-3">
      <div className="label-caps mb-2 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">signpost</span>
        MESSAGE SIGNS
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant normal-case tracking-normal">ODOT · within 60 km</span>
      </div>

      {messages.length === 0 ? (
        <div className="text-[12px] text-on-surface-variant py-1">No warnings on the signs near you.</div>
      ) : (
        <div className="space-y-1.5">
          {messages.slice(0, 6).map((s) => (
            <div key={s.id} className="border border-amber-gold/30 bg-amber-gold/5 px-3 py-1.5">
              <div className="font-mono text-[12px] font-bold text-amber-gold leading-snug">{s.page1.join(' · ')}</div>
              {s.page2.length > 0 && <div className="font-mono text-[11px] text-on-surface leading-snug">then {s.page2.join(' · ')}</div>}
              <div className="font-mono text-[11px] text-on-surface-variant mt-0.5 truncate">
                {s.name.replace(/^(VMS|DMS)\s+/i, '')} · {Math.round(s.dist_km)} km
              </div>
            </div>
          ))}
        </div>
      )}

      {travel.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none flex items-center gap-1 text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
            <span className="ms text-[14px] group-open:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
            Travel-time signs ({travel.length})
          </summary>
          <div className="mt-1 space-y-1">
            {travel.map((s) => (
              <div key={s.id} className="flex items-center gap-3 font-mono text-[11px] border border-white/10 bg-white/[0.02] px-3 py-1">
                <span className="text-on-surface-variant w-24 shrink-0 truncate">{s.route} · {Math.round(s.dist_km)} km</span>
                <span className="text-on-surface">{s.text.replace(/TRAVEL TIME TO:\s*\/?\s*/i, '')}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
