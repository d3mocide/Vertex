import { useCivicStore } from '../../store'

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 56,
    background: 'rgba(15, 15, 25, 0.92)',
    color: '#fff',
    borderRadius: 6,
    padding: '8px 12px',
    maxHeight: 120,
    overflow: 'auto',
    zIndex: 100,
    fontSize: 12,
    backdropFilter: 'blur(4px)',
  },
  row: {
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    paddingBottom: 4,
    marginBottom: 4,
  },
  source: { color: '#7ec8e3', marginRight: 6 },
}

export function AlertBanner() {
  const alerts = useCivicStore((s) => s.alerts)
  if (!alerts.length) return null

  return (
    <div style={styles.banner}>
      {alerts.slice(0, 6).map((a, i) => (
        <div key={i} style={styles.row}>
          <span style={styles.source}>[{a.source}]</span>
          {a.title}
        </div>
      ))}
    </div>
  )
}
