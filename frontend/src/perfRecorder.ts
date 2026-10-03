/**
 * Opt-in frame recorder for the map (enabled with localStorage.vertexPerf = '1', see MapOverlay).
 *
 * The software-WebGL VM used for development cannot say how the map feels on a real GPU, so this captures what
 * matters there in one call from the browser console:
 *
 *   copy(JSON.stringify(await __vertexPerfRecord(20, 'pan'), null, 1))
 *
 * It records requestAnimationFrame pacing (p50/p95/p99 frame time, share of dropped frames), long main-thread tasks,
 * JS heap, how often layers are really rebuilt (the effective motion update rate) and the per-phase CPU times the
 * overlay already keeps. Nothing runs, and nothing is stored, unless a recording is started.
 */

export interface PhaseStat { n: number; total: number; max: number }

export interface PerfSummary {
  label: string
  startedAt: string
  seconds: number
  frames: number
  fps: number
  /** Refresh interval the display is assumed to run at (median frame time), used to judge dropped frames. */
  vsyncMs: number
  frameMs: { p50: number; p95: number; p99: number; max: number }
  /** Frames that took 1.5x the median or more, i.e. missed at least one refresh. */
  droppedPct: number
  /** Frames over 50 ms: visible stutter. */
  hitches: number
  longTasks: { count: number; totalMs: number; maxMs: number }
  /** Time between layer rebuilds submitted to deck.gl; this is the rate entity motion is actually updated at. */
  layerBuildMs: { n: number; p50: number; p95: number }
  heapMB: { start: number | null; end: number | null }
  phases: Record<string, { n: number; meanMs: number; maxMs: number }>
  counts: unknown
  viewport: { width: number; height: number; dpr: number }
}

interface PerformanceWithMemory extends Performance { memory?: { usedJSHeapSize: number } }

export interface VertexPerfWindow extends Window {
  __vertexPerfRecord?: (seconds?: number, label?: string) => Promise<PerfSummary>
  __vertexPerfRuns?: PerfSummary[]
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

/** Percentile of an ascending-sorted list by nearest rank; 0 for an empty list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

export function summarizeFrames(intervals: number[]): Pick<PerfSummary, 'frames' | 'vsyncMs' | 'frameMs' | 'droppedPct' | 'hitches'> {
  const sorted = [...intervals].sort((a, b) => a - b)
  const vsync = percentile(sorted, 50)
  const dropped = vsync > 0 ? intervals.filter(d => d >= vsync * 1.5).length : 0
  return {
    frames: intervals.length,
    vsyncMs: round(vsync),
    frameMs: { p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted[sorted.length - 1] ?? 0) },
    droppedPct: intervals.length ? round((100 * dropped) / intervals.length, 1) : 0,
    hitches: intervals.filter(d => d > 50).length,
  }
}

export function summarizeBuilds(marks: number[]): PerfSummary['layerBuildMs'] {
  const gaps: number[] = []
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i] - marks[i - 1])
  const sorted = gaps.sort((a, b) => a - b)
  return { n: marks.length, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)) }
}

export function summarizePhases(stats: Record<string, PhaseStat>): PerfSummary['phases'] {
  const out: PerfSummary['phases'] = {}
  for (const [name, s] of Object.entries(stats)) {
    if (s.n > 0) out[name] = { n: s.n, meanMs: round(s.total / s.n, 3), maxMs: round(s.max, 3) }
  }
  return out
}

let recording = false
let buildMarks: number[] = []

/** Called by the overlay each time it submits rebuilt layers; free unless a recording is in progress. */
export function markLayerBuild(now: number): void {
  if (recording) buildMarks.push(now)
}

interface RecorderHooks {
  /** The overlay's live per-phase stats (cleared at the start of a recording so maxima belong to it). */
  phaseStats: Record<string, PhaseStat>
  counts: () => unknown
}

function recordOnce(seconds: number, label: string, hooks: RecorderHooks): Promise<PerfSummary> {
  return new Promise((resolve) => {
    recording = true
    buildMarks = []
    for (const key of Object.keys(hooks.phaseStats)) delete hooks.phaseStats[key]
    const perf = performance as PerformanceWithMemory
    const heapStart = perf.memory ? perf.memory.usedJSHeapSize / 1048576 : null
    const longTasks = { count: 0, totalMs: 0, maxMs: 0 }
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.count++; longTasks.totalMs += entry.duration
          if (entry.duration > longTasks.maxMs) longTasks.maxMs = entry.duration
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { /* long-task timing is not available in every browser */ }

    const startedAt = new Date().toISOString()
    const t0 = performance.now()
    const intervals: number[] = []
    let last = t0
    const frame = (now: number) => {
      intervals.push(now - last)
      last = now
      if (now - t0 < seconds * 1000) { requestAnimationFrame(frame); return }
      recording = false
      observer?.disconnect()
      const summary: PerfSummary = {
        label,
        startedAt,
        seconds: round((now - t0) / 1000, 1),
        ...summarizeFrames(intervals.slice(1)),
        fps: round(intervals.length / ((now - t0) / 1000), 1),
        longTasks: { count: longTasks.count, totalMs: round(longTasks.totalMs, 1), maxMs: round(longTasks.maxMs, 1) },
        layerBuildMs: summarizeBuilds(buildMarks),
        heapMB: { start: heapStart == null ? null : round(heapStart, 1), end: perf.memory ? round(perf.memory.usedJSHeapSize / 1048576, 1) : null },
        phases: summarizePhases(hooks.phaseStats),
        counts: hooks.counts(),
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
      }
      resolve(summary)
    }
    requestAnimationFrame((now) => { last = now; requestAnimationFrame(frame) })
  })
}

/** Exposes window.__vertexPerfRecord(seconds, label). One recording at a time; results also collect in window.__vertexPerfRuns. */
export function installPerfRecorder(hooks: RecorderHooks): () => void {
  const w = window as VertexPerfWindow
  w.__vertexPerfRuns = w.__vertexPerfRuns ?? []
  w.__vertexPerfRecord = async (seconds = 20, label = '') => {
    if (recording) throw new Error('a recording is already in progress')
    const summary = await recordOnce(Math.max(1, seconds), label, hooks)
    w.__vertexPerfRuns?.push(summary)
    return summary
  }
  return () => { delete w.__vertexPerfRecord }
}
