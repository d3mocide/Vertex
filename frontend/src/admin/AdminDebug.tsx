import React, { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'

const SUPPORTED_TYPES = ['adsb', 'ais', 'p25', 'meshcore', 'fire', 'aprs'] as const
type SupportedType = (typeof SUPPORTED_TYPES)[number]

type RemoteSource = {
  id: number
  type: string
  name: string
  url: string
  enabled: boolean
  source: string
}

type CheckResult = {
  name: string
  protocol: string
  ok: boolean
  status_code: number | null
  latency_ms: number
  summary?: string
  error?: string
}

type ProbeResult = {
  source: {
    id?: number | null
    type: string
    name?: string
    base_url: string
    display_url: string
    duration_seconds: number
  }
  checks: CheckResult[]
  ws?: {
    connected: boolean
    event_counts: Record<string, number>
    event_samples: string[]
    error?: string | null
  } | null
  storage?: {
    total_messages: number
    last_hour_messages: number
    latest_timestamp: string | null
  } | null
  recommendations: string[]
}

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border ${
        ok
          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
          : 'border-red-500/40 text-red-300 bg-red-500/10'
      }`}
    >
      {ok ? 'OK' : 'Fail'}
    </span>
  )
}

function CheckRow({ check }: { check: CheckResult }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0">
      <div className="w-24 shrink-0 text-[11px] text-gray-300 uppercase tracking-wider">{check.name}</div>
      <div className="w-16 shrink-0 text-[10px] text-gray-500 uppercase tracking-wider">{check.protocol}</div>
      <StatusPill ok={check.ok} />
      <span className="text-[11px] text-gray-400">{check.status_code ?? '—'}</span>
      <span className="text-[11px] text-gray-500">{check.latency_ms.toFixed(1)} ms</span>
      <span className="text-[11px] text-gray-400 truncate">{check.summary || check.error || ''}</span>
    </div>
  )
}

type SourceOutcome = 'ok' | 'fail' | 'running' | 'pending'

function SourceStatusBoard({
  sources,
  runningBySource,
  resultBySource,
  errorBySource,
  pollingEnabled,
  pollingIntervalSeconds,
  lastRunAtBySource,
  nowTick,
  selectedSourceId,
  onSelect,
}: {
  sources: RemoteSource[]
  runningBySource: Record<string, boolean>
  resultBySource: Record<string, ProbeResult>
  errorBySource: Record<string, string>
  pollingEnabled: Record<string, boolean>
  pollingIntervalSeconds: Record<string, number>
  lastRunAtBySource: Record<string, number>
  nowTick: number
  selectedSourceId: string
  onSelect: (id: string) => void
}) {
  if (sources.length === 0) return null

  return (
    <div className="border border-white/10 bg-black/30 overflow-x-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-[10px] uppercase tracking-widest text-gray-400">Source Status Board</span>
        <span className="text-[9px] text-gray-600 uppercase tracking-widest font-mono">{sources.length} source{sources.length !== 1 ? 's' : ''}</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal w-20">Type</th>
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal">Name</th>
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal w-20">Status</th>
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal w-24">Last Run</th>
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal w-24">Next Run</th>
            <th className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-gray-500 font-normal w-16">Polling</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((src) => {
            const key = String(src.id ?? src.url)
            const running = !!runningBySource[key]
            const result = resultBySource[key]
            const hasError = !!errorBySource[key]
            const lastRun = lastRunAtBySource[key] || 0
            const intervalMs = (pollingIntervalSeconds[key] || 60) * 1000
            const polling = !!pollingEnabled[key]
            const isSelected = key === selectedSourceId

            let outcome: SourceOutcome = 'pending'
            if (running) outcome = 'running'
            else if (result) outcome = (hasError || result.checks.some((c) => !c.ok)) ? 'fail' : 'ok'
            else if (hasError) outcome = 'fail'

            const lastRunAge = lastRun ? Math.floor((nowTick - lastRun) / 1000) : null
            const nextRunSecs = polling && lastRun ? Math.max(0, Math.ceil((lastRun + intervalMs - nowTick) / 1000)) : null

            const outcomeColor: Record<SourceOutcome, string> = {
              ok: 'text-emerald-400',
              fail: 'text-red-400',
              running: 'text-amber-400 animate-pulse',
              pending: 'text-gray-600',
            }
            const outcomeLabel: Record<SourceOutcome, string> = {
              ok: '● OK',
              fail: '● Fail',
              running: '● Running',
              pending: '— Pending',
            }

            return (
              <tr
                key={key}
                onClick={() => onSelect(key)}
                className={`cursor-pointer border-b border-white/5 last:border-0 transition-colors ${
                  isSelected ? 'bg-amber-gold/5 border-l-2 border-l-amber-gold/40' : 'hover:bg-white/5'
                }`}
              >
                <td className="px-3 py-2 font-mono text-[10px] text-gray-400 uppercase">{src.type}</td>
                <td className="px-3 py-2 text-gray-200 max-w-[180px] truncate">{src.name}</td>
                <td className={`px-3 py-2 font-mono text-[10px] font-bold ${outcomeColor[outcome]}`}>{outcomeLabel[outcome]}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-gray-400">
                  {lastRunAge === null ? '—' : lastRunAge < 60 ? `${lastRunAge}s ago` : `${Math.floor(lastRunAge / 60)}m ago`}
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-gray-400">
                  {nextRunSecs === null ? '—' : nextRunSecs === 0 ? 'now' : `${nextRunSecs}s`}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[9px] uppercase tracking-wider font-mono ${
                    polling ? 'text-emerald-400' : 'text-gray-600'
                  }`}>{polling ? 'on' : 'off'}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminDebug() {
  const [sources, setSources] = useState<RemoteSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(20)
  const [pollingEnabled, setPollingEnabled] = useState<Record<string, boolean>>({})
  const [pollingIntervalSeconds, setPollingIntervalSeconds] = useState<Record<string, number>>({})
  const [runningBySource, setRunningBySource] = useState<Record<string, boolean>>({})
  const [errorBySource, setErrorBySource] = useState<Record<string, string>>({})
  const [resultBySource, setResultBySource] = useState<Record<string, ProbeResult>>({})
  const [lastRunAtBySource, setLastRunAtBySource] = useState<Record<string, number>>({})
  const [nowTick, setNowTick] = useState(() => Date.now())
  const inFlightRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/debug/remote-feeds`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        const allSources = Array.isArray(data.all_sources) ? data.all_sources : []
        const filtered = allSources.filter((s: RemoteSource) => SUPPORTED_TYPES.includes(s.type as SupportedType))
        setSources(filtered)
        setPollingEnabled((prev) => {
          const next = { ...prev }
          for (const src of filtered) {
            const key = String(src.id ?? src.url)
            if (next[key] === undefined) next[key] = false
          }
          return next
        })
        setPollingIntervalSeconds((prev) => {
          const next = { ...prev }
          for (const src of filtered) {
            const key = String(src.id ?? src.url)
            if (next[key] !== undefined) continue
            next[key] = src.type === 'meshcore' || src.type === 'ais' ? 30 : 60
          }
          return next
        })
        if (filtered.length > 0) {
          setSelectedSourceId(String(filtered[0].id ?? filtered[0].url))
        }
      } catch {
        // non-fatal
      }
    }
    load()
  }, [])

  const selectedSource = useMemo(
    () => sources.find((s) => String(s.id ?? s.url) === selectedSourceId) || null,
    [sources, selectedSourceId],
  )
  const selectedSourceKey = selectedSource ? String(selectedSource.id ?? selectedSource.url) : ''
  const selectedError = selectedSourceKey ? errorBySource[selectedSourceKey] || '' : ''
  const result = selectedSourceKey ? resultBySource[selectedSourceKey] || null : null
  const selectedRunning = selectedSourceKey ? !!runningBySource[selectedSourceKey] : false
  const selectedPollingEnabled = selectedSourceKey ? !!pollingEnabled[selectedSourceKey] : false
  const selectedPollingInterval = selectedSourceKey ? pollingIntervalSeconds[selectedSourceKey] || 30 : 30

  const usesProbeWindow = useMemo(() => {
    if (!selectedSource) return false
    return selectedSource.type === 'meshcore' || selectedSource.type === 'ais'
  }, [selectedSource])

  const canRun = useMemo(() => sources.length > 0 && !!selectedSource && !selectedRunning, [sources.length, selectedSource, selectedRunning])

  const runProbeForSource = async (source: RemoteSource, isBackground = false) => {
    const sourceKey = String(source.id ?? source.url)
    if (inFlightRef.current[sourceKey]) return

    inFlightRef.current[sourceKey] = true
    setRunningBySource((prev) => ({ ...prev, [sourceKey]: true }))
    setErrorBySource((prev) => ({ ...prev, [sourceKey]: '' }))

    try {
      const res = await fetch(`${API_BASE}/admin/debug/remote-feeds/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          source_type: source.type,
          source_url: source.url,
          duration_seconds: durationSeconds,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.detail || `HTTP ${res.status}`)
      }
      setResultBySource((prev) => ({ ...prev, [sourceKey]: data as ProbeResult }))
      setLastRunAtBySource((prev) => ({ ...prev, [sourceKey]: Date.now() }))
    } catch (e) {
      const msg = String(e)
      setErrorBySource((prev) => ({ ...prev, [sourceKey]: msg }))
      setLastRunAtBySource((prev) => ({ ...prev, [sourceKey]: Date.now() }))
      if (!isBackground) {
        setResultBySource((prev) => {
          const next = { ...prev }
          delete next[sourceKey]
          return next
        })
      }
    } finally {
      inFlightRef.current[sourceKey] = false
      setRunningBySource((prev) => ({ ...prev, [sourceKey]: false }))
    }
  }

  const runProbe = async () => {
    if (!selectedSource) return
    await runProbeForSource(selectedSource)
  }

  useEffect(() => {
    const timers: number[] = []

    for (const source of sources) {
      const sourceKey = String(source.id ?? source.url)
      if (!pollingEnabled[sourceKey]) continue

      const intervalSeconds = pollingIntervalSeconds[sourceKey] || 30
      const handle = window.setInterval(() => {
        void runProbeForSource(source, true)
      }, intervalSeconds * 1000)
      timers.push(handle)
    }

    return () => {
      for (const timer of timers) {
        window.clearInterval(timer)
      }
    }
  }, [sources, pollingEnabled, pollingIntervalSeconds, durationSeconds])

  const toggleSelectedPolling = () => {
    if (!selectedSourceKey) return
    setPollingEnabled((prev) => ({ ...prev, [selectedSourceKey]: !prev[selectedSourceKey] }))
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-gray-400">Remote Feed Diagnostics</h2>
        <p className="text-xs text-gray-500">
          Run on-demand probes for remote ingestion feeds to detect silent failures before they impact operators.
        </p>

        <SourceStatusBoard
          sources={sources}
          runningBySource={runningBySource}
          resultBySource={resultBySource}
          errorBySource={errorBySource}
          pollingEnabled={pollingEnabled}
          pollingIntervalSeconds={pollingIntervalSeconds}
          lastRunAtBySource={lastRunAtBySource}
          nowTick={nowTick}
          selectedSourceId={selectedSourceId}
          onSelect={setSelectedSourceId}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 border border-white/10 bg-black/30">
          <div className="md:col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Source</label>
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              className="w-full tactical-select"
              disabled={sources.length === 0}
            >
              {sources.map((s) => (
                <option key={s.id ?? s.url} value={String(s.id ?? s.url)}>
                  [{s.type}] {s.name} ({s.url})
                </option>
              ))}
              {sources.length === 0 && <option value="">No supported remote sources configured</option>}
            </select>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Probe Window</label>
            <select
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(Number(e.target.value))}
              className="w-full tactical-select"
              disabled={!usesProbeWindow}
            >
              <option value={10}>10s</option>
              <option value={20}>20s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={runProbe}
              disabled={!canRun}
              className="w-full py-2 text-[10px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 disabled:opacity-40 transition-colors"
            >
              {selectedRunning ? 'Probing…' : 'Run Probe'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border border-white/10 bg-black/20">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Polling Status</label>
            <div className="text-xs text-gray-300">
              {selectedPollingEnabled ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Poll Interval</label>
            <select
              value={selectedPollingInterval}
              onChange={(e) => {
                if (!selectedSourceKey) return
                setPollingIntervalSeconds((prev) => ({ ...prev, [selectedSourceKey]: Number(e.target.value) }))
              }}
              className="w-full tactical-select"
              disabled={!selectedSource}
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>120s</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={toggleSelectedPolling}
              disabled={!selectedSource}
              className="w-full py-2 text-[10px] font-bold uppercase tracking-widest border border-white/20 text-gray-100 hover:bg-white/10 disabled:opacity-40 transition-colors"
            >
              {selectedPollingEnabled ? 'Disable Polling' : 'Enable Polling'}
            </button>
          </div>
        </div>

        {selectedError && <p className="text-xs text-red-400">{selectedError}</p>}
      </section>

      {result && (
        <>
          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Probe Target</h3>
            <div className="p-3 border border-white/10 bg-surface-container-low text-xs text-gray-300">
              <div>Type: <span className="text-gray-100 uppercase">{result.source.type}</span></div>
              <div>Source: <span className="text-gray-100">{result.source.display_url}</span></div>
              <div>Duration: <span className="text-gray-100">{result.source.duration_seconds}s</span></div>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Probe Checks</h3>
            <div className="border border-white/10 bg-surface-container-low">
              {result.checks.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-500">No checks were produced for this source.</p>
              ) : (
                result.checks.map((check, idx) => <CheckRow key={`${check.name}-${idx}`} check={check} />)
              )}
            </div>
          </section>

          {(result.ws || result.storage) && (
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.ws && (
                <div className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-widest text-gray-400">WebSocket Event Types</h3>
                  <div className="border border-white/10 bg-surface-container-low p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusPill ok={result.ws.connected} />
                      <span className="text-xs text-gray-300">WS Connection</span>
                    </div>
                    {result.ws.error && <p className="text-xs text-red-400">{result.ws.error}</p>}
                    <div className="space-y-1">
                      {Object.keys(result.ws.event_counts).length === 0 && (
                        <p className="text-xs text-gray-500">No events observed in probe window.</p>
                      )}
                      {Object.entries(result.ws.event_counts)
                        .sort((a, b) => b[1] - a[1])
                        .map(([eventType, count]) => (
                          <div key={eventType} className="flex justify-between text-xs font-mono">
                            <span className="text-gray-300">{eventType}</span>
                            <span className="text-gray-400">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {result.storage && (
                <div className="space-y-2">
                  <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Persisted Message State</h3>
                  <div className="border border-white/10 bg-surface-container-low p-3 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total messages</span>
                      <span className="text-gray-200 font-mono">{result.storage.total_messages}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last hour</span>
                      <span className="text-gray-200 font-mono">{result.storage.last_hour_messages}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-500">Latest timestamp</span>
                      <span className="text-gray-200 font-mono text-right">
                        {result.storage.latest_timestamp || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-widest text-gray-400">Recommendations</h3>
            <div className="border border-white/10 bg-surface-container-low p-3">
              {result.recommendations.length === 0 ? (
                <p className="text-xs text-emerald-300">No immediate issues detected.</p>
              ) : (
                <ul className="space-y-1 text-xs text-gray-200 list-disc pl-5">
                  {result.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
