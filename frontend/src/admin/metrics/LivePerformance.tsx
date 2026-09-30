import React from 'react'
import type { MetricsData } from './types'
import { MetricCard } from './Primitives'

export function LivePerformance({ metrics }: { metrics: MetricsData | null }) {
  const hist = metrics?.history ?? []
  const get = (k: keyof MetricsData['history'][0]) => hist.map((h) => h[k] as number)
  // "avg / peak" over the window, so a number is never shown without its context.
  const hint = (k: keyof MetricsData['history'][0], digits = 0, unit = '') => {
    const v = get(k)
    if (v.length < 2) return undefined
    const avg = v.reduce((a, b) => a + b, 0) / v.length
    return `avg ${avg.toFixed(digits)}${unit} · peak ${Math.max(...v).toFixed(digits)}${unit}`
  }

  return (
    <section>
      <h2 className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-3">
        API performance
        <span className="ml-2 normal-case tracking-normal font-normal">last 60 min, all backend workers</span>
      </h2>
      {metrics && !metrics.available && (
        <p className="text-xs text-on-surface-variant mb-3">Collecting baseline — check back in ~60s.</p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricCard
          label="Req / s" unit=""
          value={metrics?.available ? metrics.req_rate : null}
          values={get('req_rate')}
          hint={hint('req_rate', 1, '')}
        />
        <MetricCard
          label="Error %" unit="%"
          value={metrics?.available ? metrics.error_pct : null}
          warn={(metrics?.error_pct ?? 0) > 2}
          values={get('error_pct')}
          hint={hint('error_pct', 1, '%')}
        />
        <MetricCard
          label="P95 Latency" unit=" ms"
          value={metrics?.available ? metrics.p95_ms : null}
          warn={(metrics?.p95_ms ?? 0) > 300}
          values={get('p95_ms')}
          hint={hint('p95_ms', 0, ' ms')}
          color="#f59e0b"
        />
        <MetricCard
          label="Memory" unit=" MB"
          value={metrics?.available ? metrics.memory_mb : null}
          warn={(metrics?.memory_mb ?? 0) > 350}
          values={get('memory_mb')}
          hint={hint('memory_mb', 0, ' MB')}
          color="#f59e0b"
        />
        <MetricCard
          label="CPU" unit="%"
          value={metrics?.available ? metrics.cpu_pct : null}
          warn={(metrics?.cpu_pct ?? 0) > 70}
          values={get('cpu_pct')}
          hint={hint('cpu_pct', 0, '%')}
          color="#f59e0b"
        />
      </div>
    </section>
  )
}
