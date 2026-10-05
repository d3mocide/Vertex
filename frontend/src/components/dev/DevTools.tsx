import { useEffect, useState } from 'react'
import { useCivicPick } from '../../store'
import { setPerfEnabled } from '../../devtools/devState'
import { FramesTab } from './FramesTab'
import { TestsTab } from './TestsTab'
import { SceneTab } from './SceneTab'
import { NetworkTab } from './NetworkTab'
import { buildReport, CORNERS, CORNER_CLASS, InsetBands, LayoutBody, useLayoutMetrics, type Corner } from './LayoutTab'

// ── Developer tools ───────────────────────────────────────────────────────────
//    One panel for the things we measure on real devices:
//      Frames   live frame pacing, per-phase CPU, record any interaction
//      Tests    scripted map scenarios (pan, zoom, tilt, layer toggles, dense, terrain) with baselines
//      Scene    GPU in use, camera, what the map is drawing and the heaviest layers
//      Network  WebSocket message and data rates by type
//      Layout   safe-area insets, viewport units and DOM-layer heights (the original iOS PWA inspector)
//
//    Open via Settings → Developer → Debug Mode, or load the app with ?debug=perf (frames), ?debug=tests,
//    ?debug=scene, ?debug=network or ?debug=insets (layout). Instrumentation only runs while the tools are open.

type Tab = 'frames' | 'tests' | 'scene' | 'network' | 'layout'

const TABS: { id: Tab; label: string }[] = [
  { id: 'frames', label: 'Frames' }, { id: 'tests', label: 'Tests' }, { id: 'scene', label: 'Scene' },
  { id: 'network', label: 'Net' }, { id: 'layout', label: 'Layout' },
]

const PARAM_TAB: Record<string, Tab> = {
  '': 'layout', insets: 'layout', layout: 'layout', perf: 'frames', frames: 'frames', tests: 'tests',
  scene: 'scene', network: 'network', ws: 'network',
}

// Open/tab state outlives reloads for as long as the browser tab does (sessionStorage), because profiling sessions
// reload on purpose and the app also reloads itself (e.g. after a 401 right after sign-in). The URL is read once, when
// this module loads, and the state lives at module level so re-mounting the app shell cannot lose it either.
const SESSION_KEY = 'vertexDevTools'

function loadSession(): { open: boolean; tab: Tab } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { open?: boolean; tab?: string } | null
    const tab = raw?.tab && TABS.some(t => t.id === raw.tab) ? (raw.tab as Tab) : 'frames'
    return { open: Boolean(raw?.open), tab }
  } catch { return { open: false, tab: 'frames' } }
}

function saveSession(open: boolean, tab: Tab): void {
  try { if (open) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ open, tab })); else sessionStorage.removeItem(SESSION_KEY) } catch { /* storage blocked */ }
}

function readDebugParam(): Tab | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const value = params.get('debug')
    if (value === null || !(value in PARAM_TAB)) return null
    params.delete('debug')
    const search = params.toString()
    history.replaceState(null, '', search ? `?${search}` : window.location.pathname)
    return PARAM_TAB[value]
  } catch { return null }
}

const urlTab = readDebugParam()
const saved = loadSession()
let urlOpenRequested = urlTab !== null || saved.open
let activeTab: Tab = urlTab ?? saved.tab
saveSession(urlOpenRequested, activeTab)

export function DevTools() {
  const { debugInsets, setDebugInsets } = useCivicPick('debugInsets', 'setDebugInsets')
  const [tab, setTabState] = useState<Tab>(() => activeTab)
  const setTab = (next: Tab) => { activeTab = next; saveSession(urlOpenRequested, next); setTabState(next) }
  // Opened by the URL: kept apart from the saved Debug Mode preference, which loads after sign-in and would overwrite it.
  const [urlOpen, setUrlOpenState] = useState(() => urlOpenRequested)
  const setUrlOpen = (next: boolean) => { urlOpenRequested = next; saveSession(next, activeTab); setUrlOpenState(next) }
  const open = debugInsets || urlOpen
  const [corner, setCorner] = useState<Corner>('top-right')
  const [copied, setCopied] = useState(false)
  const layout = useLayoutMetrics(open && tab === 'layout')

  // Per-phase timing, WebSocket counters and the scene snapshot only run while the tools are open.
  useEffect(() => {
    if (!open) return
    setPerfEnabled(true)
    return () => setPerfEnabled(false)
  }, [open])

  if (!open) return null

  const copyLayout = () => {
    navigator.clipboard?.writeText(buildReport(layout)).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1200) },
      () => { /* clipboard blocked — no-op */ },
    )
  }
  const cycleCorner = () => setCorner(c => CORNERS[(CORNERS.indexOf(c) + 1) % CORNERS.length])

  return (
    <>
      {tab === 'layout' && <InsetBands metrics={layout} />}

      <div className={`fixed z-91 w-[340px] max-w-[94vw] pointer-events-auto ${CORNER_CLASS[corner]}`}>
        <div className="bg-onyx-deep/95 border border-amber-gold backdrop-blur-md max-h-[84vh] flex flex-col">
          <div className="flex items-center justify-between gap-2 px-2 h-7 border-b border-amber-gold/40 shrink-0">
            <span className="font-bold text-[10px] tracking-widest uppercase text-amber-gold">Dev Tools</span>
            <div className="flex items-center gap-1">
              {tab === 'layout' && (
                <button onClick={copyLayout} className="text-on-surface-variant hover:text-amber-gold" aria-label="Copy layout diagnostics">
                  <span className="ms text-[16px]">{copied ? 'check' : 'content_copy'}</span>
                </button>
              )}
              <button onClick={cycleCorner} className="text-on-surface-variant hover:text-amber-gold" aria-label="Move developer tools">
                <span className="ms text-[16px]">open_with</span>
              </button>
              <button onClick={() => { setDebugInsets(false); setUrlOpen(false) }} className="text-on-surface-variant hover:text-amber-gold" aria-label="Close developer tools">
                <span className="ms text-[16px]">close</span>
              </button>
            </div>
          </div>

          <div className="px-2 pt-2 shrink-0">
            <div className="grid grid-cols-5 gap-1" role="tablist" aria-label="Developer tools">
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`h-8 border font-mono text-[10px] uppercase tracking-wider transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold ${
                    tab === t.id
                      ? 'bg-amber-gold text-onyx-black border-amber-gold font-bold'
                      : 'border-white/10 text-on-surface-variant hover:text-on-surface hover:border-white/30'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2 overflow-y-auto">
            {tab === 'frames' && <FramesTab />}
            {tab === 'tests' && <TestsTab />}
            {tab === 'scene' && <SceneTab />}
            {tab === 'network' && <NetworkTab />}
            {tab === 'layout' && <LayoutBody metrics={layout} />}
          </div>
        </div>
      </div>
    </>
  )
}
