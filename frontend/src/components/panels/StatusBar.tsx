import { useCivicStore } from '../../store'

export function StatusBar() {
  const { connected, entities } = useCivicStore()
  const all       = Object.values(entities)
  const aircraft  = all.filter((e) => e.entity_type === 'aircraft').length
  const vessels   = all.filter((e) => e.entity_type === 'vessel').length
  const meshNodes = all.filter((e) => e.entity_type === 'mesh_node').length

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      left: 10,
      background: 'rgba(15, 15, 25, 0.85)',
      color: '#ccc',
      borderRadius: 6,
      padding: '5px 12px',
      fontSize: 12,
      zIndex: 100,
      display: 'flex',
      gap: 16,
      backdropFilter: 'blur(4px)',
    }}>
      <span style={{ color: connected ? '#4caf50' : '#f44336', fontWeight: 600 }}>
        {connected ? '● LIVE' : '○ OFFLINE'}
      </span>
      <span>Aircraft: {aircraft}</span>
      <span>Vessels: {vessels}</span>
      {meshNodes > 0 && <span style={{ color: '#4dac26' }}>Mesh: {meshNodes}</span>}
    </div>
  )
}
