import { useEffect, useState } from 'react'
import { API_BASE } from '../../../config'
import { authHeaders } from '../../../auth'
import { SectionTitle } from '../../common/Page'

interface NasProgram {
  kind: 'ground_stop' | 'ground_delay' | 'delay' | 'closure'
  airport: string
  reason: string
  until?: string
  avg?: string
  max?: string
  min?: string
  direction?: string
  trend?: string
  reopen?: string
}

const KIND: Record<NasProgram['kind'], { label: string; icon: string; tone: string }> = {
  ground_stop: { label: 'Ground stop', icon: 'block', tone: 'text-red-emergency' },
  ground_delay: { label: 'Ground delay program', icon: 'schedule', tone: 'text-amber-gold' },
  delay: { label: 'Delay', icon: 'flight_takeoff', tone: 'text-amber-gold' },
  closure: { label: 'Closure', icon: 'do_not_disturb_on', tone: 'text-amber-gold' },
}

function detail(p: NasProgram): string {
  if (p.kind === 'ground_stop') return p.until ? `until ${p.until}` : ''
  if (p.kind === 'ground_delay') return `avg ${p.avg ?? '?'} · max ${p.max ?? '?'}`
  if (p.kind === 'delay') return `${p.direction ?? ''} ${p.min ?? '?'} to ${p.max ?? '?'}${p.trend ? ` · ${p.trend}` : ''}`.trim()
  return p.reopen ? `reopens ${p.reopen}` : ''
}

interface NasNational { ground_stops: number; ground_delays: number; nationwide: boolean }

/** FAA ground stops, delay programs and closures at the watched airports. Hidden when there are none. */
export function NasStatusCard() {
  const [programs, setPrograms] = useState<NasProgram[]>([])
  const [national, setNational] = useState<NasNational | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/nas-status`, { headers: authHeaders() })
        if (res.ok && live) {
          const body = (await res.json()) as { programs: NasProgram[]; national?: NasNational }
          setPrograms(body.programs)
          setNational(body.national ?? null)
        }
      } catch { /* retry on the next tick */ }
    }
    void load()
    const t = window.setInterval(load, 60_000)
    return () => { live = false; window.clearInterval(t) }
  }, [])

  const stops = national?.ground_stops ?? 0
  if (programs.length === 0 && stops === 0) return null
  return (
    <section>
      <SectionTitle>Airspace · FAA</SectionTitle>
      {stops > 0 && (
        <div className={`border p-3 mb-2 flex items-center gap-2 ${national?.nationwide ? 'border-red-emergency/60 bg-red-emergency/10' : 'border-white/10 bg-surface-container/40'}`}>
          <span className={`ms text-[16px] leading-none ${national?.nationwide ? 'text-red-emergency' : 'text-amber-gold'}`} aria-hidden="true">public</span>
          <span className="text-[13px] text-on-surface font-bold">{national?.nationwide ? 'National ground stop' : 'US ground stops'}</span>
          <span className="ml-auto font-mono text-[11px] text-on-surface-variant">
            {stops} airport{stops === 1 ? '' : 's'} · {national?.ground_delays ?? 0} delay programs
          </span>
        </div>
      )}
      <ul className="stack-y-2">
        {programs.map((p, i) => {
          const k = KIND[p.kind]
          return (
            <li key={`${p.airport}-${p.kind}-${i}`} className="border border-white/10 bg-surface-container/40 p-3">
              <div className="flex items-center gap-2">
                <span className={`ms text-[16px] leading-none ${k.tone}`} aria-hidden="true">{k.icon}</span>
                <span className="font-mono text-[13px] font-bold text-on-surface">{p.airport}</span>
                <span className="text-[13px] text-on-surface">{k.label}</span>
                <span className="ml-auto font-mono text-[11px] text-on-surface-variant">{detail(p)}</span>
              </div>
              {p.reason && <p className="text-[12px] text-on-surface-variant mt-0.5 line-clamp-2">{p.reason}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
