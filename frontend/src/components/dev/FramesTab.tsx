import { useEffect, useRef, useState } from 'react'
import { Chip, ChipRow } from '../common/Page'
import { liveSampler, type LiveSnapshot } from '../../devtools/live'
import { phaseStats, resetPhases, type PhaseStat } from '../../devtools/devState'
import { copyText, useRuns } from '../../devtools/useRuns'
import { recordFrames } from '../../perfRecorder'
import { Row, SectionLabel } from './LayoutTab'

interface PerformanceWithMemory extends Performance { memory?: { usedJSHeapSize: number } }

type Tone = 'good' | 'warn' | 'bad'
const TONE_TEXT: Record<Tone, string> = { good: 'text-green-ais', warn: 'text-amber-gold', bad: 'text-red-emergency' }

/** Frame tail against the display's own refresh interval: within 1.5x is smooth, past 2x is visibly rough. */
function tone(p95: number, vsync: number): Tone {
  if (vsync <= 0) return 'good'
  return p95 <= vsync * 1.5 ? 'good' : p95 <= vsync * 2 ? 'warn' : 'bad'
}

function FrameSpark({ recent, vsync }: { recent: number[]; vsync: number }) {
  const W = 120, H = 40, MAX = 50
  const y = (ms: number) => H - (Math.min(ms, MAX) / MAX) * H
  const pts = recent.map((ms, i) => `${(i / Math.max(recent.length - 1, 1)) * W},${y(ms)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12 border border-white/10 bg-black/40" preserveAspectRatio="none" role="img"
         aria-label="Recent frame times">
      <line x1="0" x2={W} y1={y(vsync || 16.7)} y2={y(vsync || 16.7)} className="stroke-green-ais" strokeOpacity="0.4" strokeWidth="0.5" strokeDasharray="2 2" />
      <line x1="0" x2={W} y1={y(33.3)} y2={y(33.3)} className="stroke-amber-gold" strokeOpacity="0.3" strokeWidth="0.5" strokeDasharray="2 2" />
      <polyline points={pts} fill="none" className="stroke-cyan-adsb" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const DURATIONS = [10, 20, 30] as const

export function FramesTab() {
  const [snap, setSnap] = useState<LiveSnapshot>(() => liveSampler.snapshot())
  const [phases, setPhases] = useState<Record<string, PhaseStat>>({})
  const [heap, setHeap] = useState<number | null>(null)
  const [seconds, setSeconds] = useState<number>(20)
  const [label, setLabel] = useState('manual')
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runs = useRuns()
  const last = runs[runs.length - 1]

  useEffect(() => {
    liveSampler.start()
    const read = () => {
      setSnap(liveSampler.snapshot())
      setPhases(Object.fromEntries(Object.entries(phaseStats).map(([k, v]) => [k, { ...v }])))
      const m = (performance as PerformanceWithMemory).memory
      setHeap(m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null)
    }
    const id = window.setInterval(read, 500)
    return () => { window.clearInterval(id); liveSampler.stop(); abortRef.current?.abort() }
  }, [])

  const start = () => {
    abortRef.current = new AbortController()
    setElapsed(0)
    recordFrames(seconds, label.trim() || 'manual', { signal: abortRef.current.signal, onProgress: setElapsed })
      .catch(() => undefined)
      .finally(() => setElapsed(null))
  }

  const copyLast = async () => {
    if (!last) return
    if (await copyText(JSON.stringify(last, null, 1))) { setCopied(true); window.setTimeout(() => setCopied(false), 1200) }
  }

  const t = tone(snap.stats.frameMs.p95, snap.stats.vsyncMs)
  const recording = elapsed !== null
  const phaseNames = Object.keys(phases)

  return (
    <div className="stack-y-2 text-[10px]">
      <SectionLabel>Live · last 5 s</SectionLabel>
      <div className="flex items-baseline justify-between">
        <span className={`font-mono text-[22px] leading-none ${TONE_TEXT[t]}`}>{snap.fps.toFixed(0)}<span className="text-[10px] text-on-surface-variant"> fps</span></span>
        <span className="font-mono text-on-surface-variant">p95 <span className={TONE_TEXT[t]}>{snap.stats.frameMs.p95}ms</span> · drop <span className={TONE_TEXT[t]}>{snap.stats.droppedPct}%</span></span>
      </div>
      <FrameSpark recent={snap.recent} vsync={snap.stats.vsyncMs} />
      <Row label="display refresh" value={snap.stats.vsyncMs ? `${snap.stats.vsyncMs} ms` : '—'} />
      <Row label="hitches &gt;50 ms" value={snap.stats.hitches} />
      <Row label="JS heap" value={heap == null ? 'n/a' : `${heap} MB`} />

      <SectionLabel divider>Layer rebuild · CPU per rebuild</SectionLabel>
      {phaseNames.length === 0 ? (
        <div className="text-on-surface-variant">Waiting for the map to rebuild layers…</div>
      ) : (
        <>
          {phaseNames.map((name) => (
            <Row key={name} label={name} value={`${(phases[name].total / phases[name].n).toFixed(2)} ms · max ${phases[name].max.toFixed(1)}`} />
          ))}
          <button type="button" onClick={resetPhases} className="btn-ghost py-0.5! text-[9px]!">Reset</button>
        </>
      )}

      <SectionLabel divider>Record</SectionLabel>
      <ChipRow>
        {DURATIONS.map((d) => <Chip key={d} active={seconds === d} onClick={() => setSeconds(d)}>{d}s</Chip>)}
      </ChipRow>
      <input
        className="tactical-input py-1! font-mono"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="Recording label"
        placeholder="label (e.g. pan)"
        disabled={recording}
      />
      {recording ? (
        <button type="button" onClick={() => abortRef.current?.abort()} className="btn-danger w-full">
          Stop · {Math.round(elapsed ?? 0)}/{seconds}s
        </button>
      ) : (
        <button type="button" onClick={start} className="btn-primary w-full">Record {seconds}s</button>
      )}

      {last && (
        <>
          <SectionLabel divider>{`Last recording · ${last.label}${last.aborted ? ' (stopped early)' : ''}`}</SectionLabel>
          <Row label="fps / p95 / p99" value={`${last.fps} / ${last.frameMs.p95} / ${last.frameMs.p99} ms`} />
          <Row label="dropped / hitches" value={`${last.droppedPct}% / ${last.hitches}`} />
          <Row label="long tasks" value={`${last.longTasks.count} (max ${last.longTasks.maxMs} ms)`} />
          <Row label="layer rebuild p50 / p95" value={`${last.layerBuildMs.p50} / ${last.layerBuildMs.p95} ms`} />
          <button type="button" onClick={copyLast} className="btn-ghost py-0.5! text-[9px]!">{copied ? 'Copied' : 'Copy JSON'}</button>
        </>
      )}
    </div>
  )
}
