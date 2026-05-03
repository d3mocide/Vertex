import { useEffect, useState } from 'react'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

const TYPE_COLORS: Record<string, string> = {
  aircraft:       'text-cyan-adsb',
  vessel:         'text-green-ais',
  mesh_node:      'text-amber-p25',
  satellite:      'text-violet-space',
  tinygs_station: 'text-amber-p25',
}

const TYPE_ICONS: Record<string, string> = {
  aircraft:       'flight',
  vessel:         'directions_boat',
  mesh_node:      'router',
  satellite:      'satellite_alt',
  tinygs_station: 'satellite',
}

/** Render a compact SVG sparkline from a numeric series. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const w = 176
  const h = 28
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={w} height={h} aria-hidden="true" className="block">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function EntityDetail() {
  const { entities, airports, selectedEntityId, selectEntity } = useCivicStore()
  const entity = selectedEntityId ? entities[selectedEntityId] : null

  // Fetch trail for sparklines (aircraft only)
  const [trail, setTrail] = useState<{ altitude?: number | null; speed?: number | null }[]>([])
  useEffect(() => {
    if (!selectedEntityId || !entity || entity.entity_type !== 'aircraft') {
      setTrail([])
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/trail?minutes=30`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((pts: { altitude?: number | null; speed?: number | null }[]) => {
        if (!cancelled) setTrail(pts)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedEntityId, entity?.entity_type])
  if (!entity) return null

  const identity = entity.identity ?? {}
  const getIdentity = (key: string): string | undefined => {
    const val = identity[key]
    if (typeof val === 'string' && val.trim()) return val
    if (typeof val === 'number') return String(val)
    return undefined
  }

  const colorClass = TYPE_COLORS[entity.entity_type] ?? 'text-amber-gold'
  const icon       = TYPE_ICONS[entity.entity_type]  ?? 'location_on'

  const rows: [string, string | undefined][] = [
    ['Type',    entity.entity_type],
    ['Source',  entity.source],
    ['ICAO24',  getIdentity('icao24')],
    ['Callsign', getIdentity('callsign')],
    ['Registration', getIdentity('registration')],
    ['Operator', getIdentity('operator')],
    ['Aircraft Type', getIdentity('type')],
    ['ICAO Type', getIdentity('icao_type')],
    ['Origin', getIdentity('origin')],
    ['Destination', getIdentity('destination')],
    ['Phase', getIdentity('phase')],
    ['Status',  entity.status],
    ['Alt',     entity.altitude != null ? `${Math.round(entity.altitude).toLocaleString()} ft` : undefined],
    ['Speed',   entity.speed    != null ? `${Math.round(entity.speed)} kts`    : undefined],
    ['Vertical Rate', entity.vertical_rate != null ? `${Math.round(entity.vertical_rate)} ft/min` : undefined],
    ['Heading', entity.heading  != null ? `${Math.round(entity.heading)}°`     : undefined],
    ['Distance', entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : undefined],
    ['Lat',     entity.lat?.toFixed(5)],
    ['Lon',     entity.lon?.toFixed(5)],
    ['Last Seen', entity.last_seen
        ? new Date(entity.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : undefined
    ],
  ]

  return (
    <aside
      className="absolute top-28 right-4 hud-panel w-56 z-30 overflow-hidden"
      aria-label={`Entity detail: ${entity.display_name ?? entity.entity_id}`}
      role="complementary"
    >
      {/* Header */}
      <div className="p-3 border-b border-amber-gold-muted bg-onyx-deep/60">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`ms text-[18px] leading-none shrink-0 ${colorClass}`}
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {icon}
            </span>
            <span className="font-bold text-[12px] text-on-surface uppercase truncate">
              {entity.display_name ?? entity.entity_id}
            </span>
          </div>
          <button
            onClick={() => selectEntity(null)}
            className="text-on-surface-variant hover:text-amber-gold transition-colors shrink-0 p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Close entity detail"
          >
            <span className="ms text-[16px] leading-none">close</span>
          </button>
        </div>
      </div>

      {/* Data rows */}
      <div className="p-3 space-y-1.5">
        {rows.filter(([, v]) => v != null).map(([label, val]) => (
          <div key={label} className="flex justify-between items-baseline gap-2">
            <span className="label-caps text-[9px]">{label}</span>
            <span className="font-mono text-[10px] text-on-surface truncate">
              {val}
            </span>
          </div>
        ))}

        {entity.entity_type === 'aircraft' && (() => {
          const altitudes = trail.map(p => p.altitude).filter((v): v is number => typeof v === 'number')
          const speeds = trail.map(p => p.speed).filter((v): v is number => typeof v === 'number')
          if (altitudes.length < 3 && speeds.length < 3) return null
          return (
            <div className="mt-2 border-t border-white/10 pt-2 space-y-2">
              {altitudes.length >= 3 && (
                <div>
                  <span className="label-caps text-[8px] block mb-0.5">Altitude (30 min)</span>
                  <Sparkline values={altitudes} color="rgb(var(--color-cyan-adsb, 0 200 255) / 0.9)" />
                </div>
              )}
              {speeds.length >= 3 && (
                <div>
                  <span className="label-caps text-[8px] block mb-0.5">Speed (30 min)</span>
                  <Sparkline values={speeds} color="rgb(var(--color-amber-gold, 255 184 0) / 0.7)" />
                </div>
              )}
            </div>
          )
        })()}

        {entity.entity_type === 'aircraft' && (() => {
          const origin = getIdentity('origin')
          const destination = getIdentity('destination')
          const originMetar = origin ? (airports[origin]?.metar as Record<string, unknown> | null | undefined) : undefined
          const destinationMetar = destination ? (airports[destination]?.metar as Record<string, unknown> | null | undefined) : undefined
          const originWx = originMetar && typeof originMetar.raw === 'string' ? originMetar.raw : undefined
          const destinationWx = destinationMetar && typeof destinationMetar.raw === 'string' ? destinationMetar.raw : undefined

          if (!originWx && !destinationWx) return null

          return (
            <div className="mt-2 border-t border-white/10 pt-2 space-y-1.5">
              {originWx && (
                <div className="flex flex-col gap-0.5">
                  <span className="label-caps text-[8px]">Origin METAR ({origin})</span>
                  <span className="font-mono text-[9px] text-on-surface-variant whitespace-pre-wrap break-words">{originWx}</span>
                </div>
              )}
              {destinationWx && (
                <div className="flex flex-col gap-0.5">
                  <span className="label-caps text-[8px]">Destination METAR ({destination})</span>
                  <span className="font-mono text-[9px] text-on-surface-variant whitespace-pre-wrap break-words">{destinationWx}</span>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Tags */}
      {entity.tags && entity.tags.length > 0 && (
        <div className="px-3 pb-3 flex flex-wrap gap-1">
          {entity.tags.map((tag) => (
            <span
              key={tag}
              className="font-mono text-[8px] uppercase tracking-widest px-1.5 py-0.5 bg-amber-gold-muted/40 text-amber-gold-dim"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </aside>
  )
}
