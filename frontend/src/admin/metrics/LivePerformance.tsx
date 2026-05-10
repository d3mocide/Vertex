import React from 'react'
import type { MetricsData } from './types'
import { MetricCard } from './Primitives'

export function LivePerformance({ metrics }: { metrics: MetricsData | null }) {
  const hist = metrics?.history ?? []
  const get = (k: keyof MetricsData['history'][0]) => hist.map((h) => h[k] as number)

  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Live Performance</h2>
      {metrics && !metrics.available && (
        <p className="text-xs text-gray-500 mb-3">Collecting baseline — check back in ~60s.</p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Req / s" unit=""
          value={metrics?.available ? metrics.req_rate : null}
          values={get('req_rate')}
        />
        <MetricCard
          label="Error %" unit="%"
          value={metrics?.available ? metrics.error_pct : null}
          warn={(metrics?.error_pct ?? 0) > 2}
          values={get('error_pct')}
          color="#ef4444"
        />
        <MetricCard
          label="P95 Latency" unit=" ms"
          value={metrics?.available ? metrics.p95_ms : null}
          warn={(metrics?.p95_ms ?? 0) > 300}
          values={get('p95_ms')}
          color="#f59e0b"
        />
        <MetricCard
          label="Memory" unit=" MB"
          value={metrics?.available ? metrics.memory_mb : null}
          warn={(metrics?.memory_mb ?? 0) > 350}
          values={get('memory_mb')}
          color="#f59e0b"
        />
        <MetricCard
          label="CPU" unit="%"
          value={metrics?.available ? metrics.cpu_pct : null}
          warn={(metrics?.cpu_pct ?? 0) > 70}
          values={get('cpu_pct')}
          color="#f59e0b"
        />
        <MetricCard
          label="WS Clients" unit=""
          value={metrics?.available ? metrics.ws_clients : null}
          values={get('ws_clients')}
          color="#00E5FF"
        />
      </div>
    </section>
  )
}
