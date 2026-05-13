import { useEffect, useState } from 'react'
import { useCivicStore, SystemEvent } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders, clearToken } from '../../auth'

async function downloadSitRep(hours: number) {
  const res = await fetch(`${API_BASE}/sitrep?hours=${hours}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const filename = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ?? 'sitrep.md'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-emergency border-red-emergency/40 bg-red-emergency/10',
  high:     'text-red-emergency border-red-emergency/30 bg-red-emergency/5',
  medium:   'text-amber-gold   border-amber-gold/40    bg-amber-gold/10',
  low:      'text-on-surface-variant border-white/10   bg-white/5',
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-red-emergency',
  high:     'bg-red-emergency/70',
  medium:   'bg-amber-gold',
  low:      'bg-on-surface-variant',
}

function severityColor(s: string) {
  return SEVERITY_COLORS[s] ?? SEVERITY_COLORS.low
}

function severityDot(s: string) {
  return SEVERITY_DOT[s] ?? SEVERITY_DOT.low
}

function EventRow({ event }: { event: SystemEvent }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = event.details && Object.keys(event.details).length > 0

  return (
    <div
      className={`border-b border-white/5 transition-colors ${hasDetails ? 'cursor-pointer hover:bg-surface-container' : ''}`}
      onClick={() => hasDetails && setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Severity dot */}
        <div className="mt-1.5 shrink-0">
          <span className={`block w-2 h-2 rounded-full ${severityDot(event.severity)}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 border text-[11px] font-bold tracking-widest uppercase ${severityColor(event.severity)}`}
            >
              {event.event_type.replace(/_/g, ' ')}
            </span>
            {event.entity_id && (
              <span className="font-mono text-[11px] text-on-surface-variant truncate">
                {event.entity_id}
              </span>
            )}
          </div>
          <p className="text-[11px] text-on-surface mt-1 leading-snug">{event.summary}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[11px] text-on-surface-variant">
              {new Date(event.ts).toLocaleString()}
            </span>
            {hasDetails && (
              <span className="ms text-[11px] text-on-surface-variant leading-none">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="px-9 pb-3">
          <pre className="text-[11px] font-mono text-on-surface-variant bg-onyx-black/40 border border-white/5 p-2 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

export function EventLogPanel() {
  const { systemEvents, setSystemEvents } = useCivicStore()
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [search, setSearch] = useState('')
  const [sitrepHours, setSitrepHours] = useState(24)
  const [sitrepExporting, setSitrepExporting] = useState(false)
  const [sitrepError, setSitrepError] = useState<string | null>(null)
  const [showSitrepMenu, setShowSitrepMenu] = useState(false)

  const handleExportSitRep = async () => {
    setSitrepExporting(true)
    setSitrepError(null)
    try {
      await downloadSitRep(sitrepHours)
      setShowSitrepMenu(false)
    } catch (e) {
      setSitrepError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setSitrepExporting(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadEvents = async () => {
      try {
        const res = await fetch(`${API_BASE}/events?hours=24`, { headers: authHeaders() })
        if (res.status === 401) {
          clearToken()
          window.location.reload()
          return
        }
        if (!res.ok) return
        const data = await res.json() as SystemEvent[]
        if (cancelled || !Array.isArray(data)) return
        setSystemEvents(data)
      } catch {
        // Keep in-memory websocket events if history fetch fails.
      }
    }

    loadEvents()
    const timer = setInterval(loadEvents, 30000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [setSystemEvents])

  const filtered = [...systemEvents]
    .reverse()
    .filter((ev) => {
      if (severityFilter !== 'all' && ev.severity !== severityFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          ev.summary.toLowerCase().includes(q) ||
          ev.event_type.toLowerCase().includes(q) ||
          (ev.entity_id?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })

  const severities: SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low']

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-24 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="ms text-[20px] text-amber-gold leading-none" aria-hidden="true">history</span>
        <div className="flex-1">
          <h2 className="font-bold text-[13px] tracking-[0.2em] uppercase text-amber-gold">Event Log</h2>
          <p className="text-[11px] text-on-surface-variant mt-0.5">
            {systemEvents.length} event{systemEvents.length !== 1 ? 's' : ''} · last 100 retained
          </p>
        </div>

        {/* SitRep Export */}
        <div className="relative">
          <button
            onClick={() => setShowSitrepMenu((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-[11px] font-bold uppercase tracking-widest transition-colors focus:outline-none ${
              showSitrepMenu
                ? 'bg-amber-gold text-onyx-black border-amber-gold'
                : 'border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10'
            }`}
          >
            <span className="ms text-[14px] leading-none">download</span>
            SitRep
          </button>

          {showSitrepMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-onyx-deep border border-white/10 z-30 shadow-xl">
              <div className="p-3 space-y-2">
                <div className="text-[11px] text-on-surface-variant uppercase tracking-widest">Time window</div>
                <div className="flex gap-1">
                  {[6, 12, 24, 48, 72].map((h) => (
                    <button
                      key={h}
                      onClick={() => setSitrepHours(h)}
                      className={`flex-1 py-1 text-[11px] font-mono border transition-colors focus:outline-none ${
                        sitrepHours === h
                          ? 'bg-amber-gold text-onyx-black border-amber-gold'
                          : 'border-white/10 text-on-surface-variant hover:border-white/30'
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                {sitrepError && (
                  <p className="text-[11px] text-red-emergency">{sitrepError}</p>
                )}
                <button
                  onClick={handleExportSitRep}
                  disabled={sitrepExporting}
                  className="w-full py-1.5 bg-amber-gold/10 border border-amber-gold/60 text-amber-gold text-[12px] font-bold uppercase tracking-widest hover:bg-amber-gold/20 transition-colors focus:outline-none disabled:opacity-50"
                >
                  {sitrepExporting ? 'Generating…' : 'Download .md'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <span className="ms absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant pointer-events-none leading-none">search</span>
          <input
            type="search"
            placeholder="Filter by summary, type, or entity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-onyx-deep/40 border border-white/10 text-on-surface placeholder-on-surface-variant text-[11px] pl-8 pr-3 py-1.5 focus:outline-none focus:border-amber-gold/60 transition-colors"
          />
        </div>

        {/* Severity filter */}
        <div
          className="flex items-center border border-white/10 bg-onyx-deep/40 divide-x divide-white/10 shrink-0"
          role="group"
          aria-label="Filter by severity"
        >
          {severities.map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(s)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest transition-colors focus:outline-none ${
                severityFilter === s
                  ? 'bg-amber-gold text-onyx-black font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              aria-pressed={severityFilter === s}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div className="border border-white/10 bg-onyx-deep/40">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <span className="ms text-[36px] leading-none mb-2">timeline</span>
            <p className="text-[11px] uppercase tracking-widest">No events{severityFilter !== 'all' || search ? ' matching filters' : ' yet'}</p>
          </div>
        ) : (
          filtered.map((ev) => <EventRow key={ev.event_id} event={ev} />)
        )}
      </div>
    </div>
  )
}
