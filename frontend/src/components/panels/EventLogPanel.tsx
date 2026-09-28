import { useEffect, useMemo, useState } from 'react'
import { SystemEvent, useCivicPick } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders, clearToken } from '../../auth'
import { PageHeader, ChipRow, Chip, EmptyState } from '../common/Page'

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

type Category = 'all' | 'radio' | 'zones' | 'anomaly' | 'seismic' | 'other'

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'all',     label: 'All',       icon: 'list' },
  { id: 'radio',   label: 'Radio',     icon: 'cell_tower' },
  { id: 'zones',   label: 'Zones',     icon: 'verified_user' },
  { id: 'anomaly', label: 'Anomalies', icon: 'monitoring' },
  { id: 'seismic', label: 'Seismic',   icon: 'earthquake' },
  { id: 'other',   label: 'Other',     icon: 'more_horiz' },
]

function categoryOf(type: string): Category {
  if (type.startsWith('p25_')) return 'radio'
  if (type.startsWith('geofence')) return 'zones'
  if (type === 'anomaly') return 'anomaly'
  if (type === 'seismic') return 'seismic'
  return 'other'
}

const ICON: Record<string, string> = {
  p25_call: 'cell_tower', geofence_entry: 'login', geofence_exit: 'logout',
  anomaly: 'monitoring', seismic: 'earthquake',
}

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-red-emergency', high: 'text-red-emergency', medium: 'text-amber-gold',
}

/** A row in the log: a raw event, or a P25 call with its start and end merged. */
interface LogRow {
  key: string
  ts: string
  type: string
  category: Category
  title: string
  meta?: string
  live?: boolean
  severity: string
  details?: Record<string, unknown>
}

/**
 * Newest first, with each P25 call's start/end pair collapsed into one row
 * carrying its duration (a start with no end yet is shown as live).
 */
function buildRows(events: SystemEvent[]): LogRow[] {
  const rows: LogRow[] = []
  const callKey = (ev: SystemEvent) => `${ev.details?.tgid ?? ''}|${ev.details?.started_at ?? ev.ts}`
  const ended = new Set(events.filter((e) => e.event_type === 'p25_call_end').map(callKey))
  for (const ev of events) {
    if (ev.event_type === 'p25_call_start' && ended.has(callKey(ev))) continue
    if (ev.event_type === 'p25_call_end' || ev.event_type === 'p25_call_start') {
      const d = ev.details ?? {}
      const start = Date.parse(String(d.started_at ?? ev.ts))
      const end = d.ended_at ? Date.parse(String(d.ended_at)) : NaN
      const secs = Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null
      rows.push({
        key: ev.event_id,
        ts: String(d.started_at ?? ev.ts),
        type: 'p25_call',
        category: 'radio',
        title: String(d.tag ?? ev.summary),
        meta: [d.tgid != null ? `TG ${d.tgid}` : null, secs != null ? `${secs}s` : null].filter(Boolean).join(' · '),
        live: ev.event_type === 'p25_call_start',
        severity: ev.severity,
        details: ev.details,
      })
      continue
    }
    rows.push({
      key: ev.event_id,
      ts: ev.ts,
      type: ev.event_type,
      category: categoryOf(ev.event_type),
      title: ev.summary,
      meta: ev.entity_id ?? undefined,
      severity: ev.severity,
      details: ev.details,
    })
  }
  return rows.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
}

const hourLabel = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric' })
}

function EventRow({ row }: { row: LogRow }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = !!row.details && Object.keys(row.details).length > 0
  const tone = SEVERITY_TEXT[row.severity] ?? 'text-on-surface-variant'
  return (
    <li className="border-b border-white/5 last:border-b-0">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={hasDetails ? expanded : undefined}
        className="w-full flex items-center gap-3 px-3 lg:px-4 py-2.5 text-left enabled:hover:bg-surface-container transition-colors focus:outline-none focus-visible:bg-surface-container"
      >
        <span className="font-mono text-[12px] text-on-surface-variant w-[4.5rem] shrink-0">
          {/* AM/PM is in the hour heading above; keep the column one line. */}
          {new Date(row.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).replace(/\s?[AP]M$/i, '')}
        </span>
        <span className={`ms text-[18px] leading-none shrink-0 ${row.live ? 'text-red-emergency' : tone}`} aria-hidden="true">
          {ICON[row.type] ?? 'fiber_manual_record'}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] text-on-surface truncate">{row.title}</span>
          {(row.meta || row.live) && (
            <span className="block font-mono text-[11px] text-on-surface-variant truncate">
              {row.live && <span className="text-red-emergency font-bold mr-1.5">LIVE</span>}
              {row.meta}
            </span>
          )}
        </span>
        {hasDetails && (
          <span className="ms text-[18px] text-on-surface-variant leading-none shrink-0" aria-hidden="true">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <pre className="mx-3 lg:mx-4 mb-3 text-[11px] font-mono text-on-surface-variant bg-onyx-black/40 border border-white/5 p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(row.details, null, 2)}
        </pre>
      )}
    </li>
  )
}

export function EventLogPanel() {
  const { systemEvents, setSystemEvents } = useCivicPick('systemEvents', 'setSystemEvents')
  const [category, setCategory] = useState<Category>('all')
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

  const rows = useMemo(() => buildRows(systemEvents), [systemEvents])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length }
    for (const r of rows) c[r.category] = (c[r.category] ?? 0) + 1
    return c
  }, [rows])
  const q = search.trim().toLowerCase()
  const filtered = rows.filter((r) =>
    (category === 'all' || r.category === category)
    && (!q || r.title.toLowerCase().includes(q) || r.type.includes(q) || (r.meta?.toLowerCase().includes(q) ?? false)))

  // Group consecutive rows under hour headings.
  const groups: { label: string; rows: LogRow[] }[] = []
  for (const r of filtered) {
    const label = hourLabel(r.ts)
    if (groups.length === 0 || groups[groups.length - 1].label !== label) groups.push({ label, rows: [] })
    groups[groups.length - 1].rows.push(r)
  }
  const oldest = rows.length ? rows[rows.length - 1].ts : null

  return (
    <div>
      <PageHeader
        icon="history"
        title="Event Log"
        subtitle={`${rows.length} entries${oldest ? ` since ${new Date(oldest).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`}
        status={
          <div className="relative">
            <button
              onClick={() => setShowSitrepMenu((v) => !v)}
              className={`flex items-center gap-1.5 h-9 lg:h-auto px-2.5 py-1.5 border text-[11px] font-bold uppercase tracking-widest transition-colors focus:outline-none ${
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
        }
      />

      <div className="p-4 lg:p-6 space-y-3">
        <div className="relative">
          <span className="ms absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant pointer-events-none leading-none" aria-hidden="true">search</span>
          <input
            type="search"
            placeholder="Search events…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search events"
            className="w-full h-10 bg-onyx-deep/40 border border-white/10 text-on-surface placeholder-on-surface-variant text-[14px] lg:text-[13px] pl-10 pr-3 focus:outline-none focus:border-amber-gold/60 transition-colors"
          />
        </div>

        <ChipRow>
          {CATEGORIES.filter((c) => c.id === 'all' || counts[c.id]).map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
              {c.label} <span className="opacity-70">{counts[c.id] ?? 0}</span>
            </Chip>
          ))}
        </ChipRow>

        {filtered.length === 0 ? (
          <EmptyState icon="timeline">No events{category !== 'all' || q ? ' match these filters' : ' yet'}.</EmptyState>
        ) : (
          groups.map((g) => (
            <section key={g.label + g.rows[0].key}>
              <h3 className="label-caps py-2">{g.label}</h3>
              <ul className="border border-white/10 bg-onyx-deep/40">
                {g.rows.map((r) => <EventRow key={r.key} row={r} />)}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
