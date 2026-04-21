import { useCivicStore } from '../../store'

const TYPE_COLORS: Record<string, string> = {
  aircraft:  'text-cyan-adsb',
  vessel:    'text-green-ais',
  mesh_node: 'text-amber-p25',
}

const TYPE_ICONS: Record<string, string> = {
  aircraft:  'flight',
  vessel:    'directions_boat',
  mesh_node: 'router',
}

export function EntityDetail() {
  const { entities, selectedEntityId, selectEntity } = useCivicStore()
  const entity = selectedEntityId ? entities[selectedEntityId] : null
  if (!entity) return null

  const colorClass = TYPE_COLORS[entity.entity_type] ?? 'text-amber-gold'
  const icon       = TYPE_ICONS[entity.entity_type]  ?? 'location_on'

  const rows: [string, string | undefined][] = [
    ['Type',    entity.entity_type],
    ['Source',  entity.source],
    ['Status',  entity.status],
    ['Alt',     entity.altitude != null ? `${Math.round(entity.altitude).toLocaleString()} ft` : undefined],
    ['Speed',   entity.speed    != null ? `${Math.round(entity.speed)} kts`    : undefined],
    ['Heading', entity.heading  != null ? `${Math.round(entity.heading)}°`     : undefined],
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
