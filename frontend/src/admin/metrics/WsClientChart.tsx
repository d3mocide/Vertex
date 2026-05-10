import React from 'react'
import type { HistoryPoint } from './types'

export function WsClientChart({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">WebSocket Clients</h2>
        <p className="text-xs text-gray-600">Collecting history…</p>
      </section>
    )
  }

  const max = Math.max(...history.map((h) => h.ws_clients), 1)
  const H = 120
  const W = 100
  const pts = history.map((h, i) => {
    const x = (i / (history.length - 1)) * W
    const y = H - (h.ws_clients / max) * H
    return `${x},${y}`
  })
  const polyline = pts.join(' ')
  const current = history[history.length - 1].ws_clients

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">
        WebSocket Clients
        <span className="ml-2 text-sky-400 normal-case tracking-normal font-mono">{current} now</span>
      </h2>
      <div className="border border-white/10 bg-black/30 p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-32"
        >
          <polyline
            points={polyline}
            fill="none"
            stroke="rgb(56 189 248 / 0.6)"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
          {/* fill under curve */}
          <polyline
            points={`0,${H} ${polyline} ${W},${H}`}
            fill="rgb(56 189 248 / 0.08)"
            stroke="none"
          />
        </svg>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-gray-600 font-mono">60m ago</span>
          <span className="text-[9px] text-gray-600 font-mono">now</span>
        </div>
      </div>
    </section>
  )
}
