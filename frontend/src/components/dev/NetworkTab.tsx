import { useEffect, useRef, useState } from 'react'
import { readWsStats, resetWsStats, type WsStats } from '../../devtools/devState'
import { Row, SectionLabel } from './LayoutTab'

interface Rate { msgs: number; kbps: number }

export function NetworkTab() {
  const [stats, setStats] = useState<WsStats>(() => readWsStats())
  const [rate, setRate] = useState<Rate>({ msgs: 0, kbps: 0 })
  const prev = useRef<{ t: number; messages: number; bytes: number } | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = readWsStats()
      const now = performance.now()
      const p = prev.current
      if (p && s.messages >= p.messages) {
        const dt = (now - p.t) / 1000
        setRate({ msgs: Math.round(((s.messages - p.messages) / dt) * 10) / 10, kbps: Math.round(((s.bytes - p.bytes) / 1024 / dt) * 10) / 10 })
      }
      prev.current = { t: now, messages: s.messages, bytes: s.bytes }
      setStats(s)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const types = Object.entries(stats.byType).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
  const since = Math.round((Date.now() - stats.since) / 1000)

  return (
    <div className="stack-y-1.5 text-[10px]">
      <SectionLabel>WebSocket · live</SectionLabel>
      <Row label="messages / s" value={rate.msgs} />
      <Row label="data / s" value={`${rate.kbps} KB`} />

      <SectionLabel divider>{`Since reset (${since}s)`}</SectionLabel>
      <Row label="messages" value={stats.messages} />
      <Row label="data" value={`${Math.round(stats.bytes / 1024)} KB`} />

      <SectionLabel divider>By message type</SectionLabel>
      {types.length === 0 && <div className="text-on-surface-variant">No messages since the tools were opened.</div>}
      {types.map(([type, t]) => <Row key={type} label={type} value={`${t.n} · ${Math.round(t.bytes / 1024)} KB`} />)}
      <button type="button" onClick={() => { resetWsStats(); prev.current = null; setStats(readWsStats()) }} className="btn-ghost py-0.5! text-[9px]!">Reset</button>
    </div>
  )
}
