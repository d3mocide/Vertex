import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

type MetricsData = {
  available: boolean
  req_rate: number
  error_pct: number
  memory_mb: number
  cpu_pct: number
  p95_ms: number
  history: Array<{ ts: number; req_rate: number; error_pct: number; memory_mb: number; p95_ms: number }>
}

type StorageData = {
  observation_count: number
  entity_count: number
  entity_type_counts: Record<string, number>
  retention_days: number
}

function Sparkline({ values, color = '#f59e0b' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className="h-10 opacity-30 text-[9px] text-center pt-3">No data</div>
  const max = Math.max(...values, 0.001)
  const w = 200
  const h = 40
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - (v / max) * (h - 4) - 2
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function MetricCard({
  label,
  value,
  unit,
  warn,
  history,
  histKey,
}: {
  label: string
  value: number | null
  unit: string
  warn?: boolean
  history: MetricsData['history']
  histKey: keyof MetricsData['history'][0]
}) {
  const vals = history.map((h) => h[histKey] as number)
  return (
    <div className="border border-white/10 bg-black/30 p-3">
      <div className={`text-xl font-mono font-bold ${warn ? 'text-red-400' : 'text-amber-400'}`}>
        {value !== null ? `${value}${unit}` : '—'}
      </div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <Sparkline values={vals} color={warn ? '#f87171' : '#f59e0b'} />
    </div>
  )
}

export default function AdminMetrics() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null)
  const [storage, setStorage] = useState<StorageData | null>(null)
  const [retentionDays, setRetentionDays] = useState(30)
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionSaved, setRetentionSaved] = useState(false)

  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/metrics`, { headers: authHeaders() })
      if (res.ok) setMetrics(await res.json())
    } catch { /* non-fatal */ }
  }, [])

  const loadStorage = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/storage`, { headers: authHeaders() })
      if (res.ok) {
        const data: StorageData = await res.json()
        setStorage(data)
        setRetentionDays(data.retention_days)
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadMetrics()
    loadStorage()
    const t = setInterval(loadMetrics, 15_000)
    return () => clearInterval(t)
  }, [loadMetrics, loadStorage])

  const saveRetention = async () => {
    setRetentionSaving(true)
    try {
      await fetch(`${API_BASE}/admin/retention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ retention_days: retentionDays }),
      })
      setRetentionSaved(true)
      setTimeout(() => setRetentionSaved(false), 2000)
      await loadStorage()
    } catch { /* non-fatal */ } finally {
      setRetentionSaving(false)
    }
  }

  const hist = metrics?.history ?? []

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Live metrics grid */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Live Performance</h2>
        {metrics && !metrics.available && (
          <p className="text-xs text-gray-500">Metrics not yet available — collecting baseline data.</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Req / s"
            value={metrics?.available ? metrics.req_rate : null}
            unit=""
            history={hist}
            histKey="req_rate"
          />
          <MetricCard
            label="Error %"
            value={metrics?.available ? metrics.error_pct : null}
            unit="%"
            warn={(metrics?.error_pct ?? 0) > 5}
            history={hist}
            histKey="error_pct"
          />
          <MetricCard
            label="P95 Latency"
            value={metrics?.available ? metrics.p95_ms : null}
            unit=" ms"
            warn={(metrics?.p95_ms ?? 0) > 500}
            history={hist}
            histKey="p95_ms"
          />
          <MetricCard
            label="Memory"
            value={metrics?.available ? metrics.memory_mb : null}
            unit=" MB"
            history={hist}
            histKey="memory_mb"
          />
        </div>
        {metrics?.available && (
          <p className="text-[9px] text-gray-600 mt-2">
            CPU: {metrics.cpu_pct}% &nbsp;·&nbsp; 6-minute rolling window
          </p>
        )}
      </section>

      {/* Storage stats */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Storage</h2>
        {storage ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-white/10 bg-black/30 p-3 text-center">
              <div className="text-xl font-mono font-bold text-amber-400">
                {storage.observation_count.toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Observations</div>
            </div>
            <div className="border border-white/10 bg-black/30 p-3 text-center">
              <div className="text-xl font-mono font-bold text-amber-400">
                {storage.entity_count.toLocaleString()}
              </div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Entities</div>
            </div>
            {Object.entries(storage.entity_type_counts).map(([type, count]) => (
              <div key={type} className="border border-white/10 bg-black/30 p-3 text-center">
                <div className="text-xl font-mono font-bold text-gray-300">{count.toLocaleString()}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{type}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Loading…</p>
        )}
      </section>

      {/* Data retention */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-gray-500 mb-3">Data Retention</h2>
        <div className="border border-white/10 bg-black/30 p-4 max-w-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Keep observations for</span>
            <span className="font-mono text-amber-400 text-sm">{retentionDays}d</span>
          </div>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="w-full accent-amber-500"
            aria-label="Retention days"
          />
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>1d</span><span>365d</span>
          </div>
          <button
            onClick={saveRetention}
            disabled={retentionSaving}
            className="w-full py-1.5 text-[10px] font-bold uppercase tracking-widest border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-50"
          >
            {retentionSaved ? 'Saved' : retentionSaving ? 'Saving…' : 'Save Retention Policy'}
          </button>
        </div>
      </section>
    </div>
  )
}
