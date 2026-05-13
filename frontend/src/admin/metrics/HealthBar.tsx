import React from 'react'
import type { MetricsData } from './types'

type Props = {
  metrics: MetricsData | null
  dbPingMs: number
  redisPingMs: number
  pollerOkCount: number
  pollerTotal: number
}

function Pill({ label, ms, ok }: { label: string; ms: number; ok: boolean }) {
  const color = ms < 0 ? 'bg-red-500/20 text-red-400 border-red-500/40'
    : ok ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
    : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 border text-[11px] font-mono uppercase tracking-wider ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ms < 0 ? 'bg-red-400' : ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      {label}
      {ms >= 0 && <span className="opacity-60">{ms}ms</span>}
    </div>
  )
}

export function HealthBar({ metrics, dbPingMs, redisPingMs, pollerOkCount, pollerTotal }: Props) {
  const dbOk = dbPingMs >= 0 && dbPingMs < 100
  const redisOk = redisPingMs >= 0 && redisPingMs < 50
  const pollersOk = pollerTotal > 0 && pollerOkCount === pollerTotal
  const pollersDegraded = pollerOkCount > 0 && pollerOkCount < pollerTotal

  const pollerColor = pollerTotal === 0
    ? 'bg-gray-500/20 text-gray-400 border-gray-500/40'
    : pollersOk
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
    : pollersDegraded
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
    : 'bg-red-500/20 text-red-400 border-red-500/40'

  const pollerDot = pollerTotal === 0 ? 'bg-gray-400'
    : pollersOk ? 'bg-emerald-400'
    : pollersDegraded ? 'bg-amber-400'
    : 'bg-red-400'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-widest text-gray-600 mr-1">System</span>
      <Pill label="PostgreSQL" ms={dbPingMs} ok={dbOk} />
      <Pill label="Redis" ms={redisPingMs} ok={redisOk} />
      <div className={`flex items-center gap-1.5 px-2 py-1 border text-[11px] font-mono uppercase tracking-wider ${pollerColor}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${pollerDot}`} />
        Pollers {pollerOkCount}/{pollerTotal}
      </div>
      {metrics && (
        <div className="flex items-center gap-1.5 px-2 py-1 border border-white/10 text-[11px] font-mono uppercase tracking-wider text-gray-400">
          <span className="material-symbols-outlined text-[12px]">wifi</span>
          {metrics.ws_clients} WS
        </div>
      )}
    </div>
  )
}
