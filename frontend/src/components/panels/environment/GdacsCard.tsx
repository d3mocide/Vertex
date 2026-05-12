import { useEffect, useState } from 'react'
import type { SystemEvent } from '../../../store'
import { API_BASE } from '../../../config'
import { authHeaders, clearToken } from '../../../auth'

interface GdacsDetails {
  lat?: number
  lon?: number
  event_type_code?: string
  event_label?: string
  alert_level?: string
  severity_value?: number
  severity_unit?: string
  country?: string
  dist_km?: number
  url?: string
  pub_ts?: string
}

function alertColor(level: string | undefined): string {
  if (level === 'Red')    return 'text-red-400'
  if (level === 'Orange') return 'text-orange-400'
  return 'text-emerald-400'
}

function alertBg(level: string | undefined): string {
  if (level === 'Red')    return 'border-red-500/20 bg-red-500/5'
  if (level === 'Orange') return 'border-orange-500/20 bg-orange-500/5'
  return 'border-white/10 bg-white/[0.02]'
}

function eventIcon(code: string | undefined): string {
  const icons: Record<string, string> = {
    EQ: 'earthquake', TC: 'cyclone', FL: 'water', VO: 'volcano_outline',
    WF: 'local_fire_department', DR: 'drought', TS: 'tsunami',
  }
  return icons[code ?? ''] ?? 'warning'
}

export function GdacsCard() {
  const [events, setEvents] = useState<SystemEvent[]>([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/events?hours=72`, { headers: authHeaders() })
        if (res.status === 401) { clearToken(); window.location.reload(); return }
        if (!res.ok) return
        const data = await res.json() as SystemEvent[]
        if (cancelled || !Array.isArray(data)) return
        setEvents(data.filter((ev) => ev.event_type === 'gdacs'))
      } catch { /* keep last known */ }
    }

    load()
    const t = setInterval(load, 15 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const redCount = events.filter((e) => (e.details as GdacsDetails)?.alert_level === 'Red').length
  const orangeCount = events.filter((e) => (e.details as GdacsDetails)?.alert_level === 'Orange').length

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-orange-400" aria-hidden="true">public</span>
        GDACS DISASTER ALERTS
        {(redCount > 0 || orangeCount > 0) && (
          <div className="ml-auto flex items-center gap-2">
            {redCount > 0 && (
              <span className="font-mono text-[9px] text-red-400">{redCount} RED</span>
            )}
            {orangeCount > 0 && (
              <span className="font-mono text-[9px] text-orange-400">{orangeCount} ORANGE</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-end justify-between mb-3">
        <div className="flex flex-col">
          <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Last 72 Hours</span>
          <span className="text-[18px] font-black text-on-surface tracking-tight">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
            No significant global alerts
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.slice(0, 5).map((ev) => {
            const d = (ev.details ?? {}) as GdacsDetails
            const icon = eventIcon(d.event_type_code)
            const color = alertColor(d.alert_level)
            const bg = alertBg(d.alert_level)
            const sevText = d.severity_value != null
              ? `${d.event_type_code === 'EQ' ? 'M' : ''}${d.severity_value.toFixed(1)} ${d.severity_unit ?? ''}`.trim()
              : d.alert_level ?? ev.severity.toUpperCase()
            return (
              <div key={ev.event_id} className={`border px-3 py-2 ${bg}`}>
                <div className="flex items-center gap-2">
                  <span className={`ms text-[12px] leading-none ${color}`} aria-hidden="true">{icon}</span>
                  <span className="text-[10px] font-bold text-on-surface truncate flex-1">{ev.summary}</span>
                  <span className={`font-mono text-[9px] ${color} shrink-0`}>{sevText}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
                    {new Date(ev.ts).toLocaleString()}
                  </span>
                  {d.dist_km != null && (
                    <span className="font-mono text-[8px] text-sky-400/70 shrink-0">
                      {d.dist_km > 999 ? `${(d.dist_km / 1000).toFixed(1)}k km` : `${Math.round(d.dist_km)} km`}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
