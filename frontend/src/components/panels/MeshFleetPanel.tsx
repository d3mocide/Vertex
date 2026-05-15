import { useMemo } from 'react'
import type { Entity } from '../../store'

function formatAge(iso: string | undefined): string {
  if (!iso) return '—'
  const ageSec = (Date.now() - new Date(iso).getTime()) / 1000
  if (ageSec < 120) return 'just now'
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`
  return `${Math.floor(ageSec / 3600)}h ago`
}

function batteryBarColor(level: number): string {
  if (level >= 60) return 'bg-green-ais'
  if (level >= 30) return 'bg-amber-gold'
  return 'bg-red-emergency'
}

function batteryTextColor(level: number): string {
  if (level >= 60) return 'text-green-ais'
  if (level >= 30) return 'text-amber-gold'
  return 'text-red-emergency'
}

interface FleetRow {
  entity_id:   string
  name:        string
  battery:     number | null
  voltage:     number | null
  onRadio:     boolean
  contactType: string
  lastSeen:    string | undefined
}

function toFleetRow(e: Entity): FleetRow {
  const id = e.identity ?? {}
  return {
    entity_id:   e.entity_id,
    name:        e.display_name ?? e.entity_id.split(':').pop() ?? e.entity_id,
    battery:     typeof id.battery_level === 'number' ? id.battery_level : null,
    voltage:     typeof id.voltage === 'number' ? id.voltage : null,
    onRadio:     Array.isArray(e.tags) && e.tags.includes('on_radio'),
    contactType: (id.contact_type as string | undefined) ?? 'unknown',
    lastSeen:    e.last_seen,
  }
}

export function MeshFleetPanel({ entities }: { entities: Entity[] }) {
  const rows = useMemo(() => {
    return entities
      .filter(e => e.entity_type === 'mesh_node')
      .map(toFleetRow)
      // Sort by battery ascending so lowest (most critical) nodes appear first.
      // Nodes with no battery data sort to the bottom.
      .sort((a, b) => {
        if (a.battery === null && b.battery === null) return 0
        if (a.battery === null) return 1
        if (b.battery === null) return -1
        return a.battery - b.battery
      })
  }, [entities])

  if (rows.length === 0) {
    return (
      <div className="py-10 border border-dashed border-white/10 rounded-sm flex flex-col items-center justify-center opacity-30">
        <span className="ms text-3xl mb-2 animate-pulse">router</span>
        <span className="text-[11px] uppercase font-mono tracking-[0.2em]">No mesh nodes detected</span>
      </div>
    )
  }

  return (
    <div className="border border-white/10 bg-white/5 overflow-hidden rounded-sm">
      {/* Column headers */}
      <div className="bg-white/5 px-3 py-1.5 border-b border-white/5 grid grid-cols-[1fr_72px_32px_52px_56px] gap-2 items-center">
        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Node</span>
        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest text-right">Battery</span>
        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest text-center">RF</span>
        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest text-right">Type</span>
        <span className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest text-right">Seen</span>
      </div>

      {rows.map(row => (
        <div
          key={row.entity_id}
          className="grid grid-cols-[1fr_72px_32px_52px_56px] gap-2 items-center px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors last:border-b-0"
        >
          {/* Name */}
          <span className="text-[11px] font-bold text-on-surface truncate">{row.name}</span>

          {/* Battery */}
          <div>
            {row.battery !== null ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className={`font-mono text-[10px] font-bold leading-none ${batteryTextColor(row.battery)}`}>
                  {row.battery}%
                </span>
                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${batteryBarColor(row.battery)} ${row.battery < 20 ? 'animate-pulse' : ''}`}
                    style={{ width: `${row.battery}%` }}
                  />
                </div>
                {row.voltage !== null && (
                  <span className="font-mono text-[9px] text-on-surface-variant leading-none">{row.voltage.toFixed(1)}V</span>
                )}
              </div>
            ) : (
              <span className="font-mono text-[11px] text-on-surface-variant/40 block text-right">—</span>
            )}
          </div>

          {/* On-radio indicator */}
          <div className="flex justify-center">
            <span className={`w-2 h-2 rounded-full ${row.onRadio ? 'bg-green-ais animate-pulse' : 'bg-white/20'}`} />
          </div>

          {/* Contact type */}
          <span className="font-mono text-[10px] text-on-surface-variant uppercase text-right truncate">{row.contactType}</span>

          {/* Last seen */}
          <span className="font-mono text-[10px] text-on-surface-variant text-right">{formatAge(row.lastSeen)}</span>
        </div>
      ))}
    </div>
  )
}
