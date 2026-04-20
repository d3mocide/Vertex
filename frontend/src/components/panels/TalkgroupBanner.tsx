import { useCivicStore } from '../../store'

export function TalkgroupBanner() {
  const radio = useCivicStore((s) => s.radio)
  if (!radio || radio.state === 'idle' || !radio.tgid) return null

  const freqMhz = radio.freq_hz ? (radio.freq_hz / 1e6).toFixed(5) : null

  return (
    <div style={{
      position: 'absolute',
      bottom: 72,
      right: 10,
      background: 'rgba(180, 60, 20, 0.92)',
      color: '#fff',
      borderRadius: 6,
      padding: '6px 12px',
      zIndex: 100,
      fontSize: 12,
      backdropFilter: 'blur(4px)',
      maxWidth: 220,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 13 }}>
        {radio.tag || `TGID ${radio.tgid}`}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.75)', display: 'flex', gap: 10 }}>
        <span>TG: {radio.tgid}</span>
        {freqMhz && <span>{freqMhz} MHz</span>}
      </div>
    </div>
  )
}
