/**
 * Frame recorder for the map.
 *
 * The software-WebGL VM used for development cannot say how the map feels on a real GPU, so this captures what
 * matters there in one call, from the Developer tools (Settings, or ?debug=perf) or from the browser console:
 *
 *   copy(JSON.stringify(await __vertexPerfRecord(20, 'pan'), null, 1))
 *
 * It records requestAnimationFrame pacing (p50/p95/p99 frame time, share of dropped frames), long main-thread tasks,
 * JS heap, how often layers are really rebuilt (the effective motion update rate), the per-phase CPU times the
 * overlay keeps, the scene size and which GPU is rendering. Nothing is recorded unless a recording is started.
 */
import {
  addRun, getScene, isPerfEnabled, phaseStats, resetPhases, setPerfEnabled, type PhaseStat,
} from './devtools/devState'

export type { PhaseStat }

export interface PerfSummary {
  label: string
  startedAt: string
  seconds: number
  /** True when the recording was cut short; the numbers cover only the time that ran. */
  aborted?: boolean
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
  gpu: string
}

interface PerformanceWithMemory extends Performance { memory?: { usedJSHeapSize: number } }

export interface VertexPerfWindow extends Window {
  __vertexPerfRecord?: (seconds?: number, label?: string) => Promise<PerfSummary>
  __vertexPerfRuns?: unknown[]
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

/** True for the CPU rasterizers browsers fall back to when no GPU is available: numbers from them mean little. */
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
}

let gpuCache: string | null = null
export function gpuRenderer(): string {
  if (gpuCache != null) return gpuCache
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    gpuCache = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  } catch { gpuCache = 'unknown' }
  return gpuCache
}

export interface RunDelta {
  label: string
  fps: number
  p95Ms: number
  droppedPct: number
  longTasks: number
  buildP50Ms: number
  /** Worse (true) when frame tail, dropped frames or long tasks grew past the noise floor; better when they shrank. */
  verdict: 'worse' | 'better' | 'same'
}

/** Difference between a run and the baseline run of the same label (positive = larger than the baseline). */
export function compareSummaries(current: PerfSummary, baseline: PerfSummary): RunDelta {
  const d = {
    fps: round(current.fps - baseline.fps, 1),
    p95Ms: round(current.frameMs.p95 - baseline.frameMs.p95),
    droppedPct: round(current.droppedPct - baseline.droppedPct, 1),
    longTasks: current.longTasks.count - baseline.longTasks.count,
    buildP50Ms: round(current.layerBuildMs.p50 - baseline.layerBuildMs.p50),
  }
  const worse = d.p95Ms > Math.max(2, baseline.frameMs.p95 * 0.15) || d.droppedPct > 3 || d.longTasks > 2
  const better = d.p95Ms < -Math.max(2, baseline.frameMs.p95 * 0.15) || d.droppedPct < -3 || d.longTasks < -2
  return { label: current.label, ...d, verdict: worse ? 'worse' : better ? 'better' : 'same' }
}

let recording = false
let buildMarks: number[] = []

export function isRecording(): boolean { return recording }

/** Called by the overlay each time it submits rebuilt layers; free unless a recording is in progress. */
export function markLayerBuild(now: number): void {
  if (recording) buildMarks.push(now)
}

export interface RecordOptions {
  /** Ends the recording early; the summary then has `aborted: true`. */
  signal?: AbortSignal
  /** Called about twice a second with the seconds elapsed. */
  onProgress?: (elapsedSeconds: number) => void
}

/** Record frame pacing for `seconds`. One recording at a time; the result is also kept in the shared run list. */
export function recordFrames(seconds: number, label: string, opts: RecordOptions = {}): Promise<PerfSummary> {
  if (recording) return Promise.reject(new Error('a recording is already in progress'))
  return new Promise((resolve) => {
    recording = true
    buildMarks = []
    const wasEnabled = isPerfEnabled()
    setPerfEnabled(true)                      // per-phase timing only runs while instrumentation is on
    resetPhases()
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
    let lastProgress = 0
    const frame = (now: number) => {
      intervals.push(now - last)
      last = now
      const aborted = Boolean(opts.signal?.aborted)
      if (now - lastProgress >= 500) { lastProgress = now; opts.onProgress?.((now - t0) / 1000) }
      if (!aborted && now - t0 < seconds * 1000) { requestAnimationFrame(frame); return }
      recording = false
      observer?.disconnect()
      if (!wasEnabled) setPerfEnabled(false)
      const scene = getScene()
      const elapsed = (now - t0) / 1000
      const summary: PerfSummary = {
        label,
        startedAt,
        seconds: round(elapsed, 1),
        ...(aborted ? { aborted: true } : {}),
        ...summarizeFrames(intervals.slice(1)),
        fps: round(intervals.length / elapsed, 1),
        longTasks: { count: longTasks.count, totalMs: round(longTasks.totalMs, 1), maxMs: round(longTasks.maxMs, 1) },
        layerBuildMs: summarizeBuilds(buildMarks),
        heapMB: { start: heapStart == null ? null : round(heapStart, 1), end: perf.memory ? round(perf.memory.usedJSHeapSize / 1048576, 1) : null },
        phases: summarizePhases(phaseStats),
        counts: scene ? { tracks: scene.tracks, entities: scene.entities, layers: scene.layers.length } : null,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        gpu: gpuRenderer(),
      }
      addRun(summary)
      resolve(summary)
    }
    requestAnimationFrame((now) => { last = now; lastProgress = now; requestAnimationFrame(frame) })
  })
}

/** Exposes window.__vertexPerfRecord(seconds, label) for the console. */
export function installPerfRecorder(): () => void {
  const w = window as VertexPerfWindow
  w.__vertexPerfRecord = (seconds = 20, label = '') => recordFrames(Math.max(1, seconds), label)
  return () => { delete w.__vertexPerfRecord }
}
