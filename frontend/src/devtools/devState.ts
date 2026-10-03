/**
 * Shared runtime state for the developer tools (components/dev) and the map overlay's profiler.
 *
 * Everything here is inert until developer tools are open, a recording is running, or localStorage.vertexPerf = '1'.
 * Hot paths only call `isPerfEnabled()` and return immediately when it is false.
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

export interface PhaseStat { n: number; total: number; max: number }

const FLAG_KEY = 'vertexPerf'

function readFlag(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === '1' } catch { return false }
}

let enabled = readFlag()
const flagPersisted = readFlag()

export function isPerfEnabled(): boolean { return enabled }

/** Instrumentation on or off. It stays on while the persistent flag is set, whatever callers ask for. */
export function setPerfEnabled(on: boolean): void { enabled = on || flagPersisted }

/** Make the instrumentation survive reloads (the console equivalent of localStorage.vertexPerf = '1'). */
export function persistPerf(on: boolean): void {
  try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY) } catch { /* storage blocked */ }
}

// ── Per-phase CPU time kept by the overlay's animation tick ─────────────────

export const phaseStats: Record<string, PhaseStat> = {}

export function markPhase(name: string, t0: number): void {
  const d = performance.now() - t0
  const st = phaseStats[name] ?? (phaseStats[name] = { n: 0, total: 0, max: 0 })
  st.n++; st.total += d; if (d > st.max) st.max = d
}

export function resetPhases(): void {
  for (const key of Object.keys(phaseStats)) delete phaseStats[key]
}

// ── What the map is currently drawing ────────────────────────────────────────

export interface SceneSnapshot {
  ts: number
  tracks: number
  entities: number
  layers: { id: string; count: number | null }[]
}

let scene: SceneSnapshot | null = null
export function setScene(next: SceneSnapshot): void { scene = next }
export function getScene(): SceneSnapshot | null { return scene }

// ── The live MapLibre instance (scenarios drive the camera through it) ───────

let devMap: MapLibreMap | null = null
export function registerDevMap(map: MapLibreMap | null): void { devMap = map }
export function getDevMap(): MapLibreMap | null { return devMap }

// ── WebSocket traffic ────────────────────────────────────────────────────────

export interface WsStats {
  since: number
  messages: number
  bytes: number
  byType: Record<string, { n: number; bytes: number }>
}

let ws: WsStats = { since: Date.now(), messages: 0, bytes: 0, byType: {} }

export function recordWsMessage(bytes: number, type: string): void {
  if (!enabled) return
  ws.messages++; ws.bytes += bytes
  const t = ws.byType[type] ?? (ws.byType[type] = { n: 0, bytes: 0 })
  t.n++; t.bytes += bytes
}

export function readWsStats(): WsStats { return { ...ws, byType: { ...ws.byType } } }
export function resetWsStats(): void { ws = { since: Date.now(), messages: 0, bytes: 0, byType: {} } }

// ── Recorded runs (shared by the Frames and Tests tabs and the console API) ──

type RunListener = () => void
const runListeners = new Set<RunListener>()
let runs: unknown[] = []
let runsVersion = 0

export function getRuns<T>(): T[] { return runs as T[] }
export function runsSnapshotVersion(): number { return runsVersion }
export function addRun(run: unknown): void {
  runs = [...runs, run]; runsVersion++
  ;(window as unknown as { __vertexPerfRuns?: unknown[] }).__vertexPerfRuns = runs
  runListeners.forEach(fn => fn())
}
export function clearRuns(): void {
  runs = []; runsVersion++
  ;(window as unknown as { __vertexPerfRuns?: unknown[] }).__vertexPerfRuns = runs
  runListeners.forEach(fn => fn())
}
export function subscribeRuns(fn: RunListener): () => void {
  runListeners.add(fn)
  return () => { runListeners.delete(fn) }
}

// ── Saved user preferences must never see a scenario's temporary toggles ─────
//
// The app auto-saves every persisted UI change to the server (hooks/usePreferences). Scenarios flip layer toggles on
// purpose, so while one runs the saver is suspended: nothing is written until the toggles are back as they were, and a
// page closed mid-run leaves the saved preferences untouched.

let prefSaveSuspensions = 0

/** Pause preference saving; call the returned function exactly once to resume. Suspensions nest. */
export function suspendPrefSaving(): () => void {
  prefSaveSuspensions++
  let released = false
  return () => { if (!released) { released = true; prefSaveSuspensions-- } }
}

export function isPrefSavingSuspended(): boolean { return prefSaveSuspensions > 0 }
