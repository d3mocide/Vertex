import { useCivicStore } from '../../store'

export function EntityDetail() {
  const { entities, selectedEntityId, selectEntity } = useCivicStore()
  const entity = selectedEntityId ? entities[selectedEntityId] : null
  if (!entity) return null

  const rows: [string, string | number | undefined][] = [
    ['Type',    entity.entity_type],
    ['Source',  entity.source],
    ['Status',  entity.status],
    ['Alt',     entity.altitude != null ? `${Math.round(entity.altitude)} ft` : undefined],
    ['Speed',   entity.speed    != null ? `${Math.round(entity.speed)} kts`   : undefined],
    ['Heading', entity.heading  != null ? `${Math.round(entity.heading)}°`    : undefined],
    ['Lat',     entity.lat?.toFixed(4)],
    ['Lon',     entity.lon?.toFixed(4)],
  ]

  return (
    <div style={{
      position: 'absolute',
      top: 10,
      right: 10,
      background: 'rgba(15, 15, 25, 0.92)',
      color: '#fff',
      borderRadius: 6,
      padding: 12,
      width: 220,
      zIndex: 100,
      fontSize: 12,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{entity.display_name}</strong>
        <button
          onClick={() => selectEntity(null)}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14 }}
        >✕</button>
      </div>
      {rows.filter(([, v]) => v != null).map(([label, val]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ color: '#7ec8e3' }}>{label}</span>
          <span>{val}</span>
        </div>
      ))}
    </div>
  )
}
