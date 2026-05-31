import { useEffect, useState, useCallback } from 'react'
import { useCivicStore } from '../store'

// ── Developer overlay: surfaces the exact iOS safe-area insets, viewport
//    geometry, and DOM-layer heights on-device, so we never have to guess at
//    pixel offsets when chasing a standalone-PWA letterbox / gap.
//
//    The DOM-LAYERS section is the money shot for fullscreen bugs: it measures
//    the rendered height of <html>, <body>, and #root independently. When one
//    layer stops short of the screen bottom (e.g. body resolves to innerHeight
//    894 while the screen is 956) you can see *exactly* which element is the
//    culprit — html=crimson · body=green · #root=blue.
//
//    Enable via Settings → System → "Layout / Safe-Area Inspector", or by
//    loading the app with ?debug=insets in the URL.

interface Insets { top: number; right: number; bottom: number; left: number }
interface LayerRect { h: number; top: number; bottom: number }

interface Metrics {
  insets: Insets
  innerW: number
  innerH: number
  docElW: number
  docElH: number
  screenW: number
  screenH: number
  availH: number
  vvW: number
  vvH: number
  vvScale: number
  vvOffsetTop: number
  dpr: number
  // viewport units, measured live (iOS resolves these inconsistently)
  vh: number
  lvh: number
  svh: number
  dvh: number
  // DOM layer geometry
  layers: { html: LayerRect; body: LayerRect; root: LayerRect }
  gap: number // innerH − #root.bottom (≠0 ⇒ shell doesn't match the window)
  // mode
  iosVer: string
  navStandalone: boolean
  displayMode: boolean
  orientation: string
}

// Measure env(safe-area-inset-*) by reading them back off a hidden probe.
function readInsets(): Insets {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const insets = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  }
  probe.remove()
  return insets
}

// Resolve 100vh / 100lvh / 100svh / 100dvh by measuring hidden probes — the
// only reliable way to see what each unit actually computes to on this device.
function measureUnits(): { vh: number; lvh: number; svh: number; dvh: number } {
  const units = ['vh', 'lvh', 'svh', 'dvh'] as const
  const out = { vh: 0, lvh: 0, svh: 0, dvh: 0 }
  const probes = units.map(u => {
    const d = document.createElement('div')
    d.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100${u};`
    document.body.appendChild(d)
    return [u, d] as const
  })
  for (const [u, d] of probes) {
    out[u] = Math.round(d.getBoundingClientRect().height)
    d.remove()
  }
  return out
}

function readLayer(el: Element | null): LayerRect {
  if (!el) return { h: 0, top: 0, bottom: 0 }
  const r = el.getBoundingClientRect()
  return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }
}

function readIosVersion(): string {
  const m = /OS (\d+)[._](\d+)(?:[._](\d+))?/.exec(navigator.userAgent)
  if (!m) return '—'
  return `${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

function readMetrics(): Metrics {
  const vv = window.visualViewport
  const navStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  const units = measureUnits()
  const layers = {
    html: readLayer(document.documentElement),
    body: readLayer(document.body),
    root: readLayer(document.getElementById('root')),
  }
  return {
    insets: readInsets(),
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docElW: document.documentElement.clientWidth,
    docElH: document.documentElement.clientHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    availH: window.screen.availHeight,
    vvW: vv ? Math.round(vv.width) : 0,
    vvH: vv ? Math.round(vv.height) : 0,
    vvScale: vv ? Math.round(vv.scale * 1000) / 1000 : 1,
    vvOffsetTop: vv ? Math.round(vv.offsetTop) : 0,
    dpr: window.devicePixelRatio,
    vh: units.vh,
    lvh: units.lvh,
    svh: units.svh,
    dvh: units.dvh,
    layers,
    gap: window.innerHeight - layers.root.bottom,
    iosVer: readIosVersion(),
    navStandalone,
    displayMode,
    orientation: window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape',
  }
}

// Plain-text dump for the Copy button — paste straight into a bug report.
function buildReport(m: Metrics): string {
  const L = (k: string, v: LayerRect) => `${k} rect H ${v.h} (${v.top}→${v.bottom})`
  return [
    'VERTEX LAYOUT DIAG',
    `iOS ver               ${m.iosVer}`,
    `nav.standalone        ${m.navStandalone}`,
    `display-mode standalone ${m.displayMode}`,
    `window.inner W×H      ${m.innerW} × ${m.innerH}`,
    `docEl.client W×H      ${m.docElW} × ${m.docElH}`,
    `screen W×H            ${m.screenW} × ${m.screenH}`,
    `screen.availH         ${m.availH}`,
    `100vh / 100lvh        ${m.vh} / ${m.lvh}`,
    `100svh / 100dvh       ${m.svh} / ${m.dvh}`,
    `visualViewport        ${m.vvW} × ${m.vvH} (offY ${m.vvOffsetTop}, scale ${m.vvScale})`,
    `devicePixelRatio      ${m.dpr}`,
    `env inset T/R/B/L     ${m.insets.top} / ${m.insets.right} / ${m.insets.bottom} / ${m.insets.left}`,
    L('html', m.layers.html),
    L('body', m.layers.body),
    L('#root', m.layers.root),
    `GAP innerH − rootBot  ${m.gap}px`,
    `orientation           ${m.orientation}`,
  ].join('\n')
}

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
type Corner = (typeof CORNERS)[number]

const CORNER_CLASS: Record<Corner, string> = {
  'top-left': 'top-2 left-2 pt-safe pl-safe',
  'top-right': 'top-2 right-2 pt-safe pr-safe',
  'bottom-left': 'bottom-2 left-2 pb-safe pl-safe',
  'bottom-right': 'bottom-2 right-2 pb-safe pr-safe',
}

// Layer colour encoding (which DOM element — a data distinction, not decor):
//   html → red-emergency (crimson) · body → green-ais · #root → cyan-adsb (blue)
type LayerKey = 'html' | 'body' | 'root'
const LAYER_META: Record<LayerKey, { name: string; dot: string; text: string; bg: string }> = {
  html: { name: 'html',  dot: 'bg-red-emergency', text: 'text-red-emergency', bg: 'bg-red-emergency' },
  body: { name: 'body',  dot: 'bg-green-ais',     text: 'text-green-ais',     bg: 'bg-green-ais' },
  root: { name: '#root', dot: 'bg-cyan-adsb',     text: 'text-cyan-adsb',     bg: 'bg-cyan-adsb' },
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-mono text-amber-gold">{value}</span>
    </div>
  )
}

function SectionLabel({ children, divider }: { children: string; divider?: boolean }) {
  return (
    <div
      className={`font-bold text-[9px] tracking-widest uppercase text-on-surface-variant pb-0.5 ${
        divider ? 'pt-1 border-t border-white/10' : ''
      }`}
    >
      {children}
    </div>
  )
}

function LayerRow({ k, rect }: { k: LayerKey; rect: LayerRect }) {
  const meta = LAYER_META[k]
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
        <span className={meta.text}>{meta.name}</span>
      </span>
      <span className="font-mono text-amber-gold">
        {rect.h} <span className="text-on-surface-variant">({rect.top}→{rect.bottom})</span>
      </span>
    </div>
  )
}

export function DevInsetInspector() {
  const { debugInsets, setDebugInsets } = useCivicStore()
  const [metrics, setMetrics] = useState<Metrics>(() => readMetrics())
  const [corner, setCorner] = useState<Corner>('top-right')
  const [copied, setCopied] = useState(false)

  // Allow ?debug=insets (or bare ?debug) to switch the inspector on.
  // Strip the param immediately so a refresh doesn't re-enable it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('debug') && (params.get('debug') === 'insets' || params.get('debug') === '')) {
      setDebugInsets(true)
      params.delete('debug')
      const newSearch = params.toString()
      history.replaceState(null, '', newSearch ? `?${newSearch}` : window.location.pathname)
    }
  }, [setDebugInsets])

  const refresh = useCallback(() => setMetrics(readMetrics()), [])

  useEffect(() => {
    if (!debugInsets) return
    refresh()
    const vv = window.visualViewport
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    vv?.addEventListener('resize', refresh)
    vv?.addEventListener('scroll', refresh)
    const id = window.setInterval(refresh, 1000) // catch UA chrome show/hide
    return () => {
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
      vv?.removeEventListener('resize', refresh)
      vv?.removeEventListener('scroll', refresh)
      window.clearInterval(id)
    }
  }, [debugInsets, refresh])

  if (!debugInsets) return null

  const { insets, layers } = metrics
  const cycleCorner = () =>
    setCorner(c => CORNERS[(CORNERS.indexOf(c) + 1) % CORNERS.length])

  const copyReport = () => {
    navigator.clipboard?.writeText(buildReport(metrics)).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      },
      () => {/* clipboard blocked — no-op */},
    )
  }

  // Horizontal markers at each DOM layer's bottom edge. Where the green (body)
  // or red (html) line falls short of the blue (#root) / screen bottom, you've
  // found the gap. Labels are staggered so coincident lines stay readable.
  const layerOrder: LayerKey[] = ['html', 'body', 'root']
  const labelLeft: Record<LayerKey, string> = { html: '8px', body: '34%', root: '64%' }

  return (
    <>
      {/* Inset visualisers — translucent amber bands over each safe area. */}
      <div className="fixed inset-0 z-[90] pointer-events-none" aria-hidden="true">
        {insets.top > 0 && (
          <div
            className="absolute top-0 left-0 right-0 bg-amber-gold/20 border-b border-amber-gold/60 flex items-center justify-center"
            style={{ height: insets.top }}
          >
            <span className="font-mono text-[10px] text-amber-gold">top {insets.top}px</span>
          </div>
        )}
        {insets.bottom > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-amber-gold/20 border-t border-amber-gold/60 flex items-center justify-center"
            style={{ height: insets.bottom }}
          >
            <span className="font-mono text-[10px] text-amber-gold">bottom {insets.bottom}px</span>
          </div>
        )}
        {insets.left > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 bg-amber-gold/20 border-r border-amber-gold/60"
            style={{ width: insets.left }}
          />
        )}
        {insets.right > 0 && (
          <div
            className="absolute top-0 bottom-0 right-0 bg-amber-gold/20 border-l border-amber-gold/60"
            style={{ width: insets.right }}
          />
        )}

        {/* DOM layer bottom-edge markers */}
        {layerOrder.map(k => {
          const rect = layers[k]
          if (rect.h <= 0) return null
          const meta = LAYER_META[k]
          return (
            <div key={k}>
              <div className={`absolute left-0 right-0 h-px ${meta.bg} opacity-70`} style={{ top: rect.bottom }} />
              <div
                className={`absolute font-mono text-[9px] ${meta.text} bg-onyx-black/80 px-1 leading-none py-0.5`}
                style={{ top: Math.max(0, rect.bottom - 14), left: labelLeft[k] }}
              >
                {meta.name} {rect.bottom}
              </div>
            </div>
          )
        })}
      </div>

      {/* Readout panel */}
      <div className={`fixed z-[91] w-[228px] pointer-events-auto ${CORNER_CLASS[corner]}`}>
        <div className="bg-onyx-deep/95 border border-amber-gold backdrop-blur-md max-h-[82vh] flex flex-col">
          <div className="flex items-center justify-between gap-2 px-2 h-7 border-b border-amber-gold/40 shrink-0">
            <span className="font-bold text-[10px] tracking-widest uppercase text-amber-gold">
              Layout Diag
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={copyReport}
                className="text-on-surface-variant hover:text-amber-gold"
                aria-label="Copy diagnostics"
              >
                <span className="ms text-[16px]">{copied ? 'check' : 'content_copy'}</span>
              </button>
              <button
                onClick={cycleCorner}
                className="text-on-surface-variant hover:text-amber-gold"
                aria-label="Move inspector"
              >
                <span className="ms text-[16px]">open_with</span>
              </button>
              <button
                onClick={() => setDebugInsets(false)}
                className="text-on-surface-variant hover:text-amber-gold"
                aria-label="Close inspector"
              >
                <span className="ms text-[16px]">close</span>
              </button>
            </div>
          </div>

          <div className="p-2 space-y-1.5 text-[10px] overflow-y-auto">
            <SectionLabel>Mode</SectionLabel>
            <Row label="iOS ver"     value={metrics.iosVer} />
            <Row label="nav.standalone" value={String(metrics.navStandalone)} />
            <Row label="display-mode"   value={metrics.displayMode ? 'standalone' : 'browser'} />
            <Row label="orientation"    value={metrics.orientation} />

            <SectionLabel divider>Safe-area insets</SectionLabel>
            <Row label="top"    value={`${insets.top}px`} />
            <Row label="right"  value={`${insets.right}px`} />
            <Row label="bottom" value={`${insets.bottom}px`} />
            <Row label="left"   value={`${insets.left}px`} />

            <SectionLabel divider>Viewport</SectionLabel>
            <Row label="window"   value={`${metrics.innerW}×${metrics.innerH}`} />
            <Row label="docEl"    value={`${metrics.docElW}×${metrics.docElH}`} />
            <Row label="visual"   value={`${metrics.vvW}×${metrics.vvH}`} />
            <Row label="vv scale" value={metrics.vvScale} />
            <Row label="vv offY"  value={`${metrics.vvOffsetTop}px`} />
            <Row label="screen"   value={`${metrics.screenW}×${metrics.screenH}`} />
            <Row label="availH"   value={`${metrics.availH}px`} />
            <Row label="dpr"      value={metrics.dpr} />

            <SectionLabel divider>Viewport units</SectionLabel>
            <Row label="100vh"  value={`${metrics.vh}px`} />
            <Row label="100lvh" value={`${metrics.lvh}px`} />
            <Row label="100svh" value={`${metrics.svh}px`} />
            <Row label="100dvh" value={`${metrics.dvh}px`} />

            <SectionLabel divider>DOM layers · H (top→bot)</SectionLabel>
            <LayerRow k="html" rect={layers.html} />
            <LayerRow k="body" rect={layers.body} />
            <LayerRow k="root" rect={layers.root} />
            <div className="flex items-center justify-between gap-4 pt-0.5">
              <span className="text-on-surface-variant">GAP innerH−rootBot</span>
              <span className={`font-mono ${metrics.gap === 0 ? 'text-green-ais' : 'text-red-emergency'}`}>
                {metrics.gap}px
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
