/**
 * Scripted, repeatable test cases for the map. Each scenario drives the camera and/or layer toggles while the frame
 * recorder runs, then puts the camera and toggles back exactly as they were, so a run never changes what you see.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCivicStore } from '../store'
import { getDevMap, suspendPrefSaving } from './devState'
import { gpuRenderer, isSoftwareRenderer, recordFrames, type PerfSummary } from '../perfRecorder'

export interface ScenarioContext {
  map: MapLibreMap
  signal: AbortSignal
  /** performance.now() timestamp at which the recording ends. */
  deadline: number
}

export interface Scenario {
  id: string
  label: string
  description: string
  seconds: number
  /** Refused under software rendering, where it can crash the map instead of just running slowly. */
  requiresGpu?: boolean
  drive: (ctx: ScenarioContext) => Promise<void>
}

/** Optional overlays the toggle and dense scenarios switch (visibility keys in the store). */
export const OVERLAY_KEYS = [
  'radarVisible', 'smokeVisible', 'goesVisible', 'firePerimetersVisible', 'fireDangerVisible', 'outagesVisible',
  'camerasVisible', 'geofencesVisible', 'trailsVisible', 'lightningVisible', 'nwsAlertsVisible',
  'lightningDensityVisible', 'railTracksVisible', 'gaugesVisible', 'dispatchVisible',
] as const

type StoreRecord = Record<string, unknown>

function readToggle(key: string): boolean {
  return Boolean((useCivicStore.getState() as unknown as StoreRecord)[key])
}

function writeToggle(key: string, value: boolean): void {
  const state = useCivicStore.getState() as unknown as StoreRecord
  const setter = state[`set${key[0].toUpperCase()}${key.slice(1)}`]
  if (typeof setter === 'function') (setter as (v: boolean) => void)(value)
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  if (signal.aborted) { resolve(); return }
  const timer = window.setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve() }, { once: true })
})

const remaining = (ctx: ScenarioContext) => ctx.deadline - performance.now()

/** One camera move that ends when it is done (or the scenario is). */
async function moveTo(ctx: ScenarioContext, options: Parameters<MapLibreMap['easeTo']>[0]): Promise<void> {
  const duration = Math.min(options.duration ?? 3000, Math.max(remaining(ctx), 0))
  if (duration <= 0 || ctx.signal.aborted) return
  ctx.map.easeTo({ ...options, duration, easing: (t: number) => t })
  await sleep(duration + 50, ctx.signal)
}

async function panLoop(ctx: ScenarioContext): Promise<void> {
  const b = ctx.map.getBounds()
  const dx = (b.getEast() - b.getWest()) * 0.8
  const dy = (b.getNorth() - b.getSouth()) * 0.8
  const start = ctx.map.getCenter()
  const legs: [number, number][] = [[dx, 0], [0, -dy], [-dx, 0], [0, dy]]
  let i = 0
  while (remaining(ctx) > 100 && !ctx.signal.aborted) {
    const c = ctx.map.getCenter()
    const [lx, ly] = legs[i++ % legs.length]
    // Keep the path a loop around the start so a long scenario never drifts out of the region.
    const target: [number, number] = [c.lng + lx, c.lat + ly]
    if (i % legs.length === 0) { target[0] = start.lng; target[1] = start.lat }
    await moveTo(ctx, { center: target, duration: 2500 })
  }
}

async function zoomLoop(ctx: ScenarioContext): Promise<void> {
  const z0 = ctx.map.getZoom()
  let out = false
  while (remaining(ctx) > 100 && !ctx.signal.aborted) {
    await moveTo(ctx, { zoom: out ? z0 : z0 + 2.5, duration: 4000 })
    out = !out
  }
}

async function tiltLoop(ctx: ScenarioContext): Promise<void> {
  let step = 0
  while (remaining(ctx) > 100 && !ctx.signal.aborted) {
    step++
    await moveTo(ctx, { pitch: step % 2 ? 60 : 0, bearing: (step * 40) % 360, duration: 4000 })
  }
}

async function toggleStorm(ctx: ScenarioContext): Promise<void> {
  const keys = OVERLAY_KEYS.filter(k => k !== 'dispatchVisible')
  let i = 0
  while (remaining(ctx) > 100 && !ctx.signal.aborted) {
    const key = keys[i++ % keys.length]
    writeToggle(key, !readToggle(key))
    await sleep(1200, ctx.signal)
  }
}

export const SCENARIOS: Scenario[] = [
  { id: 'idle', label: 'Idle', description: 'Nothing touched: live motion and updates only.', seconds: 20,
    drive: async (ctx) => { await sleep(remaining(ctx), ctx.signal) } },
  { id: 'pan', label: 'Pan sweep', description: 'Continuous panning around the current view.', seconds: 20, drive: panLoop },
  { id: 'zoom', label: 'Zoom cycle', description: 'Zooms in 2.5 levels and back, repeatedly.', seconds: 20, drive: zoomLoop },
  { id: 'tilt', label: 'Tilt and rotate', description: 'Pitch to 60 degrees and rotate (the heaviest camera case).', seconds: 20, drive: tiltLoop },
  { id: 'toggles', label: 'Layer toggle storm', description: 'Flips one optional overlay every 1.2 s.', seconds: 20, drive: toggleStorm },
  { id: 'dense', label: 'Dense: all overlays', description: 'Every overlay on, then idle and pan.', seconds: 30,
    drive: async (ctx) => {
      OVERLAY_KEYS.forEach(k => writeToggle(k, true))
      await sleep(Math.max(remaining(ctx) / 3, 0), ctx.signal)
      await panLoop(ctx)
    } },
  { id: 'terrain', label: 'Terrain 3D', description: '3D terrain on, tilted view, slow rotation (needs a GPU).', seconds: 20, requiresGpu: true,
    drive: async (ctx) => {
      writeToggle('terrainEnabled', true)
      await sleep(1500, ctx.signal)
      await tiltLoop(ctx)
    } },
]

export interface RunOptions {
  /** Shorten every scenario (used by tests and quick checks). */
  seconds?: number
  signal: AbortSignal
  onProgress?: (elapsedSeconds: number) => void
}

/** Run one scenario against the live map and restore the camera and every toggle afterwards. */
export async function runScenario(s: Scenario, opts: RunOptions): Promise<PerfSummary> {
  const map = getDevMap()
  if (!map) throw new Error('the map is not ready')
  const seconds = opts.seconds ?? s.seconds
  if (s.requiresGpu && isSoftwareRenderer(gpuRenderer())) {
    throw new Error(`${s.label} needs a GPU; this browser is using software rendering (${gpuRenderer()})`)
  }
  const camera = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
  const toggles = [...OVERLAY_KEYS, 'terrainEnabled'].map(k => [k, readToggle(k)] as const)
  const deadline = performance.now() + seconds * 1000
  const resumePrefSaving = suspendPrefSaving()   // scenario toggles must not reach the saved user preferences
  try {
    const driving = s.drive({ map, signal: opts.signal, deadline }).catch(() => undefined)
    const summary = await recordFrames(seconds, s.id, { signal: opts.signal, onProgress: opts.onProgress })
    await driving
    return summary
  } finally {
    map.stop()
    map.jumpTo(camera)
    toggles.forEach(([k, v]) => writeToggle(k, v))
    resumePrefSaving()
  }
}

const BASELINE_KEY = 'vertexPerfBaseline'

export function loadBaseline(): Record<string, PerfSummary> {
  try { return JSON.parse(localStorage.getItem(BASELINE_KEY) ?? '{}') as Record<string, PerfSummary> } catch { return {} }
}

export function saveBaseline(runs: PerfSummary[]): void {
  const next: Record<string, PerfSummary> = {}
  for (const r of runs) next[r.label] = r            // the latest run of each label wins
  try { localStorage.setItem(BASELINE_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
}

export function clearBaseline(): void {
  try { localStorage.removeItem(BASELINE_KEY) } catch { /* storage blocked */ }
}
