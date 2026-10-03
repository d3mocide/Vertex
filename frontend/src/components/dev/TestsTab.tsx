import { useEffect, useRef, useState } from 'react'
import { Chip, ChipRow } from '../common/Page'
import { clearRuns, getDevMap } from '../../devtools/devState'
import { clearBaseline, loadBaseline, runScenario, saveBaseline, SCENARIOS, type Scenario } from '../../devtools/scenarios'
import { copyText, useRuns } from '../../devtools/useRuns'
import { compareSummaries, gpuRenderer, isSoftwareRenderer, type PerfSummary, type RunDelta } from '../../perfRecorder'
import { SectionLabel } from './LayoutTab'

const VERDICT_TEXT: Record<RunDelta['verdict'], string> = {
  worse: 'text-red-emergency', better: 'text-green-ais', same: 'text-on-surface-variant',
}

const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`

export function TestsTab() {
  const [quick, setQuick] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; elapsed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<Record<string, PerfSummary>>(() => loadBaseline())
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runs = useRuns()

  useEffect(() => () => abortRef.current?.abort(), [])

  // The latest run of each scenario.
  const latest: Record<string, PerfSummary> = {}
  for (const r of runs) if (SCENARIOS.some(s => s.id === r.label)) latest[r.label] = r

  const exec = async (list: Scenario[]) => {
    setError(null)
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    try {
      for (let i = 0; i < list.length && !signal.aborted; i++) {
        setRunning(list[i].id)
        setProgress({ done: i, total: list.length, elapsed: 0 })
        await runScenario(list[i], {
          seconds: quick ? 5 : undefined,
          signal,
          onProgress: (elapsed) => setProgress({ done: i, total: list.length, elapsed }),
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
      setProgress(null)
    }
  }

  const software = isSoftwareRenderer(gpuRenderer())
  const mapReady = getDevMap() !== null
  const busy = running !== null
  const ordered = SCENARIOS.filter(s => latest[s.id])

  const copyResults = async () => {
    const payload = {
      gpu: gpuRenderer(), userAgent: navigator.userAgent, results: ordered.map(s => latest[s.id]),
      baseline: Object.keys(baseline).length ? baseline : undefined,
    }
    if (await copyText(JSON.stringify(payload, null, 1))) { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }
  }

  return (
    <div className="space-y-2 text-[10px]">
      {software && (
        <div className="border border-amber-gold/60 bg-amber-gold/10 px-2 py-1 text-amber-gold">
          Software rendering detected ({gpuRenderer()}). Frame numbers from this browser say little about a real GPU.
        </div>
      )}
      {!mapReady && <div className="text-on-surface-variant">The map is not ready yet.</div>}

      <SectionLabel>Scenarios</SectionLabel>
      <ChipRow>
        <Chip active={!quick} onClick={() => setQuick(false)}>Full</Chip>
        <Chip active={quick} onClick={() => setQuick(true)}>Quick 5s</Chip>
      </ChipRow>
      <ul className="divide-y divide-white/5">
        {SCENARIOS.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-on-surface text-[11px] font-bold">{s.label} <span className="font-mono font-normal text-on-surface-variant">{quick ? 5 : s.seconds}s</span></div>
              <div className="text-on-surface-variant leading-snug">{s.description}</div>
            </div>
            <button type="button" className="btn-ghost !py-0.5 !text-[9px]" disabled={busy || !mapReady} onClick={() => exec([s])}>
              {running === s.id ? 'Running' : 'Run'}
            </button>
          </li>
        ))}
      </ul>

      {busy ? (
        <button type="button" onClick={() => abortRef.current?.abort()} className="btn-danger w-full">
          Stop · {running} {Math.round(progress?.elapsed ?? 0)}s · {(progress?.done ?? 0) + 1}/{progress?.total}
        </button>
      ) : (
        <button type="button" className="btn-primary w-full" disabled={!mapReady} onClick={() => exec(SCENARIOS)}>
          Run all · {quick ? SCENARIOS.length * 5 : SCENARIOS.reduce((a, s) => a + s.seconds, 0)}s
        </button>
      )}
      {error && <div className="text-red-emergency">{error}</div>}

      {ordered.length > 0 && (
        <>
          <SectionLabel divider>{`Results${Object.keys(baseline).length ? ' · vs baseline' : ''}`}</SectionLabel>
          <div className="font-mono text-[10px]">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 text-on-surface-variant pb-0.5">
              <span>scenario</span><span className="text-right">fps</span><span className="text-right">p95</span><span className="text-right">drop</span><span className="text-right">lt</span>
            </div>
            {ordered.map((s) => {
              const r = latest[s.id]
              const d = baseline[s.id] ? compareSummaries(r, baseline[s.id]) : null
              return (
                <div key={s.id} className="py-0.5 border-t border-white/5">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2">
                    <span className="text-on-surface truncate">{s.label}{r.aborted ? ' *' : ''}</span>
                    <span className="text-right text-amber-gold">{r.fps}</span>
                    <span className="text-right text-amber-gold">{r.frameMs.p95}</span>
                    <span className="text-right text-amber-gold">{r.droppedPct}%</span>
                    <span className="text-right text-amber-gold">{r.longTasks.count}</span>
                  </div>
                  {d && (
                    <div className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 ${VERDICT_TEXT[d.verdict]}`}>
                      <span>{d.verdict}</span>
                      <span className="text-right">{signed(d.fps)}</span>
                      <span className="text-right">{signed(d.p95Ms)}</span>
                      <span className="text-right">{signed(d.droppedPct)}%</span>
                      <span className="text-right">{signed(d.longTasks, 0)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" className="btn-ghost !py-0.5 !text-[9px]" onClick={copyResults}>{copied ? 'Copied' : 'Copy JSON'}</button>
            <button type="button" className="btn-ghost !py-0.5 !text-[9px]" onClick={() => { saveBaseline(ordered.map(s => latest[s.id])); setBaseline(loadBaseline()) }}>Set baseline</button>
            {Object.keys(baseline).length > 0 && (
              <button type="button" className="btn-ghost !py-0.5 !text-[9px]" onClick={() => { clearBaseline(); setBaseline({}) }}>Clear baseline</button>
            )}
            <button type="button" className="btn-ghost !py-0.5 !text-[9px]" onClick={clearRuns}>Clear results</button>
          </div>
          <div className="text-on-surface-variant leading-snug">
            fps, p95 frame ms, dropped frames, long tasks (lt). * = stopped early. Baselines persist in this browser; &quot;worse&quot; means a clearly longer frame tail, more dropped frames or more long tasks.
          </div>
        </>
      )}
    </div>
  )
}
