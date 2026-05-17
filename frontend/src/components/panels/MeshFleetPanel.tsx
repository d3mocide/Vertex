import { useEffect, useMemo, useState } from 'react'
import type { Entity } from '../../store'
import { DEFAULT_CENTER } from '../../config'
import { getDistanceMeters } from '../../layers/geoUtils'

const PAGE_SIZE = 16 // Balanced for 2-column grids

function formatAge(iso: string | undefined): string {
  if (!iso) return '—'
  const ageSec = (Date.now() - new Date(iso).getTime()) / 1000
  if (ageSec < 120) return 'just now'
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`
  return `${Math.floor(ageSec / 3600)}h ago`
}

function batteryTextColor(level: number): string {
  if (level >= 60) return 'text-green-ais'
  if (level >= 30) return 'text-amber-gold'
  return 'text-red-emergency'
}

function getBatteryIcon(level: number): string {
  if (level >= 80) return 'battery_full'
  if (level >= 55) return 'battery_6_bar'
  if (level >= 30) return 'battery_3_bar'
  if (level >= 15) return 'battery_1_bar'
  return 'battery_alert'
}

interface FleetRow {
  entity_id:   string
  name:        string
  distance_m:  number | null
  battery:     number | null
  voltage:     number | null
  onRadio:     boolean
  contactType: string
  lastSeen:    string | undefined
}

function toFleetRow(e: Entity): FleetRow {
  const id = e.identity ?? {}
  const distance_m = (typeof e.lat === 'number' && typeof e.lon === 'number')
    ? getDistanceMeters(DEFAULT_CENTER[1], DEFAULT_CENTER[0], e.lat, e.lon)
    : null

  return {
    entity_id:   e.entity_id,
    name:        e.display_name ?? e.entity_id.split(':').pop() ?? e.entity_id,
    distance_m,
    battery:     typeof id.battery_level === 'number' ? id.battery_level : null,
    voltage:     typeof id.voltage === 'number' ? id.voltage : null,
    onRadio:     Array.isArray(e.tags) && e.tags.includes('on_radio'),
    contactType: (id.contact_type as string | undefined) ?? 'unknown',
    lastSeen:    e.last_seen,
  }
}

export function MeshFleetPanel({ entities }: { entities: Entity[] }) {
  const [page, setPage] = useState(1)
  const [sortBy, setSortBy] = useState<'recent' | 'distance'>('recent') // Defaults to dynamic recent pings
  const [filterType, setFilterType] = useState<string>('all') // Filters by Room, Client, Repeater

  // Calculate total unfiltered mesh nodes to handle absolute empty state vs filtered empty state
  const totalMeshNodes = useMemo(() => {
    return entities.filter(e => e.entity_type === 'mesh_node').length
  }, [entities])

  const rows = useMemo(() => {
    let filtered = entities
      .filter(e => e.entity_type === 'mesh_node')
      .map(toFleetRow)

    // Apply Type Filter
    if (filterType !== 'all') {
      filtered = filtered.filter(r => r.contactType.toLowerCase() === filterType.toLowerCase())
    }

    if (sortBy === 'recent') {
      return filtered.sort((a, b) => {
        const timeA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0
        const timeB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0
        if (timeA !== timeB) return timeB - timeA // Most recently seen first
        return a.name.localeCompare(b.name)
      })
    } else {
      // Sort nearest nodes first. Rows with no coordinates go to the bottom.
      return filtered.sort((a, b) => {
        if (a.distance_m === null && b.distance_m === null) {
          if (a.battery === null && b.battery === null) return a.name.localeCompare(b.name)
          if (a.battery === null) return 1
          if (b.battery === null) return -1
          if (a.battery !== b.battery) return a.battery - b.battery
          return a.name.localeCompare(b.name)
        }
        if (a.distance_m === null) return 1
        if (b.distance_m === null) return -1
        if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m
        return a.name.localeCompare(b.name)
      })
    }
  }, [entities, sortBy, filterType])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return rows.slice(start, start + PAGE_SIZE)
  }, [page, rows])

  // Absolute empty state (no nodes at all in database)
  if (totalMeshNodes === 0) {
    return (
      <div className="py-10 border border-dashed border-white/10 rounded-sm flex flex-col items-center justify-center opacity-30">
        <span className="ms text-3xl mb-2 animate-pulse">hub</span>
        <span className="text-[11px] uppercase font-mono tracking-[0.2em]">No network nodes detected</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Premium Sorting & Filtering Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3 mb-1">
        {/* Left Side: Type Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest mr-1 shrink-0">
            Filter:
          </span>
          <div className="flex items-center gap-1 border border-white/10 bg-white/5 rounded-full p-0.5 shrink-0">
            {['all', 'repeater', 'client', 'room'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => { setFilterType(type); setPage(1); }}
                className={`font-mono text-[9px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-colors ${
                  filterType === type
                    ? 'bg-amber-gold text-onyx-black font-bold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {type === 'all' ? 'All' : `${type}s`}
              </button>
            ))}
          </div>
        </div>

        {/* Right Side: Sort Controls */}
        <div className="flex items-center gap-1.5 shrink-0 sm:self-end">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest mr-1 shrink-0">
            Sort:
          </span>
          <div className="flex items-center gap-1 border border-white/10 bg-white/5 rounded-full p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => { setSortBy('recent'); setPage(1); }}
              className={`font-mono text-[9px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-colors ${
                sortBy === 'recent'
                  ? 'bg-amber-gold text-onyx-black font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Last Heard
            </button>
            <button
              type="button"
              onClick={() => { setSortBy('distance'); setPage(1); }}
              className={`font-mono text-[9px] uppercase tracking-wider px-2.5 py-0.5 rounded-full transition-colors ${
                sortBy === 'distance'
                  ? 'bg-amber-gold text-onyx-black font-bold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Nearest
            </button>
          </div>
        </div>
      </div>

      {/* Empty State for Filtered View */}
      {rows.length === 0 && (
        <div className="py-12 border border-dashed border-white/10 rounded-sm flex flex-col items-center justify-center opacity-45 bg-onyx-deep/20 mt-2">
          <span className="ms text-2xl mb-2 text-amber-gold/60">filter_list_off</span>
          <span className="text-[10px] uppercase font-mono tracking-[0.2em] text-on-surface-variant">
            No {filterType}s detected matching filter
          </span>
        </div>
      )}

      {/* 2-Column Tactical Card Grid */}
      {rows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {pageRows.map(row => (
            <div
              key={row.entity_id}
              className="flex flex-col border border-white/10 bg-onyx-deep/30 rounded-sm hover:border-amber-gold/30 hover:bg-white/5 transition-all p-3 gap-2"
            >
              {/* Header: Node Name, Status, Contact Type */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    title={row.onRadio ? 'Active RF Connection' : 'Inactive RF Link'}
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      row.onRadio
                        ? 'bg-green-ais animate-pulse shadow-[0_0_8px_rgba(50,229,144,0.5)]'
                        : 'bg-white/20'
                    }`}
                  />
                  <span className="text-[11px] font-bold text-on-surface truncate" title={row.name}>
                    {row.name}
                  </span>
                </div>
                <span className="font-mono text-[9px] px-1.5 py-0.5 border border-white/10 bg-white/5 rounded-full text-on-surface-variant uppercase tracking-wider shrink-0">
                  {row.contactType}
                </span>
              </div>

              {/* Bottom Row: Battery, Distance, Last Seen */}
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-on-surface-variant pt-2 border-t border-white/5">
                {/* Battery */}
                <div className="flex items-center gap-1 shrink-0" title={row.voltage !== null ? `${row.voltage.toFixed(2)}V` : ''}>
                  {row.battery !== null ? (
                    <>
                      <span className={`ms text-[14px] ${batteryTextColor(row.battery)}`}>
                        {getBatteryIcon(row.battery)}
                      </span>
                      <span className={`font-bold ${batteryTextColor(row.battery)}`}>
                        {row.battery}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="ms text-[14px] opacity-40">battery_unknown</span>
                      <span className="opacity-40">—</span>
                    </>
                  )}
                </div>

                {/* Distance */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="ms text-[14px] opacity-60">explore</span>
                  <span>
                    {row.distance_m !== null
                      ? `${(row.distance_m / 1000).toFixed(1)} KM`
                      : '—'}
                  </span>
                </div>

                {/* Last Seen */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="ms text-[14px] opacity-60">schedule</span>
                  <span>{formatAge(row.lastSeen)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Footer */}
      {rows.length > PAGE_SIZE && (
        <div className="px-3 py-2 border border-white/10 bg-white/5 flex items-center justify-between gap-2 rounded-sm mt-1">
          <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border border-white/15 text-on-surface disabled:opacity-30 disabled:cursor-not-allowed hover:border-amber-gold/70 transition-colors"
            >
              Prev
            </button>
            <span className="font-mono text-[10px] text-on-surface-variant px-1.5">
              {page}/{totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest border border-white/15 text-on-surface disabled:opacity-30 disabled:cursor-not-allowed hover:border-amber-gold/70 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
