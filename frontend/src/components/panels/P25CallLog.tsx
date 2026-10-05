import { useEffect, useState } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { EmptyState } from '../common/Page'

interface CallRow {
  id: number
  tgid: number
  tag: string | null
  started_at: string
  duration_s: number | null
  transcription: string | null
}

const HOURS = 24
const REFRESH_MS = 15_000

const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })

/**
 * P25 call history from the recordings table: one row per call with its
 * talkgroup, duration and transcript. Loaded from the server when the tab
 * opens (the old log only showed events received while the app was open,
 * so it was empty after a fresh launch) and refreshed while visible.
 */
export function P25CallLog() {
  const radio = useCivicStore((s) => s.radio)
  const [calls, setCalls] = useState<CallRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/radio/recordings?hours=${HOURS}&limit=200`, { headers: authHeaders() })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as CallRow[]
        if (!cancelled) { setCalls(data); setError(false) }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const onAir = radio?.state === 'call' || radio?.state === 'encrypted'

  return (
    <div className="flex-1 min-h-0 border border-white/10 bg-onyx-deep/40 flex flex-col">
      <div className="bg-white/5 px-3 py-2.5 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
        <span className="label-caps">
          Calls · last {HOURS}h{calls ? ` · ${calls.length}${calls.length === 200 ? '+' : ''}` : ''}
        </span>
        {error && <span className="font-mono text-[11px] text-amber-gold">Refresh failed</span>}
      </div>

      <ul className="flex-1 overflow-y-auto custom-scrollbar">
        {onAir && (
          <li className="flex items-center gap-3 px-3 py-2.5 border-b border-white/5 bg-red-emergency/10">
            <span className="w-2 h-2 rounded-full bg-red-emergency animate-pulse shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0 text-[13px] font-semibold text-on-surface truncate">
              {radio?.tag || (radio?.tgid ? `TG ${radio.tgid}` : 'Active call')}
            </span>
            <span className="font-mono text-[11px] text-red-emergency font-bold shrink-0">
              {radio?.state === 'encrypted' ? 'ENCRYPTED' : 'ON AIR'}
            </span>
          </li>
        )}

        {calls == null && !error && (
          <li className="p-3"><EmptyState icon="hourglass_empty">Loading call history…</EmptyState></li>
        )}
        {calls != null && calls.length === 0 && (
          <li className="p-3"><EmptyState icon="radio">No calls recorded in the last {HOURS} hours.</EmptyState></li>
        )}

        {calls?.map((c) => {
          const text = c.transcription?.trim()
          return (
            <li key={c.id} className="px-3 py-2.5 border-b border-white/5 last:border-b-0">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[12px] text-on-surface-variant shrink-0 w-22">{hhmmss(c.started_at)}</span>
                <span className="flex-1 min-w-0 text-[13px] font-semibold text-on-surface truncate">
                  {c.tag || `TG ${c.tgid}`}
                </span>
                <span className="font-mono text-[11px] text-on-surface-variant shrink-0">
                  {c.duration_s != null ? `${Math.round(c.duration_s)}s` : ''}
                </span>
              </div>
              <p className={`mt-1 text-[13px] leading-snug ${text ? 'text-on-surface-variant' : 'text-on-surface-variant/50 italic'}`}>
                {text ? `“${text}”` : c.transcription == null ? 'Transcribing…' : 'No speech detected'}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
