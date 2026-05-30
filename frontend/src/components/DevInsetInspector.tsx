import { useEffect, useState, useCallback } from 'react'
import { useCivicStore } from '../store'

// ── Developer overlay: surfaces the exact iOS safe-area insets + viewport
//    geometry on-device, so we never have to guess at pixel offsets.
//
//    Enable via Settings → System → "Layout / Safe-Area Inspector", or by
//    loading the app with ?debug=insets in the URL.

interface Insets { top: number; right: number; bottom: number; left: number }

interface Metrics {
  insets: Insets
  innerW: number
  innerH: number
  screenW: number
  screenH: number
  vvW: number
  vvH: number
  vvScale: number
  vvOffsetTop: number
  dpr: number
  standalone: boolean
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

function readMetrics(): Metrics {
  const vv = window.visualViewport
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari legacy flag
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return {
    insets: readInsets(),
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    screenW: window.screen.width,
    screenH: window.screen.height,
    vvW: vv ? Math.round(vv.width) : 0,
    vvH: vv ? Math.round(vv.height) : 0,
    vvScale: vv ? Math.round(vv.scale * 1000) / 1000 : 1,
    vvOffsetTop: vv ? Math.round(vv.offsetTop) : 0,
    dpr: window.devicePixelRatio,
    standalone,
    orientation: window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape',
  }
}

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
type Corner = (typeof CORNERS)[number]

const CORNER_CLASS: Record<Corner, string> = {
  'top-left': 'top-2 left-2 pt-safe pl-safe',
  'top-right': 'top-2 right-2 pt-safe pr-safe',
  'bottom-left': 'bottom-2 left-2 pb-safe pl-safe',
  'bottom-right': 'bottom-2 right-2 pb-safe pr-safe',
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-on-surface-variant">{label}</span>
      <span className="font-mono text-amber-gold">{value}</span>
    </div>
  )
}

export function DevInsetInspector() {
  const { debugInsets, setDebugInsets } = useCivicStore()
  const [metrics, setMetrics] = useState<Metrics>(() => readMetrics())
  const [corner, setCorner] = useState<Corner>('top-right')

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

  const { insets } = metrics
  const cycleCorner = () =>
    setCorner(c => CORNERS[(CORNERS.indexOf(c) + 1) % CORNERS.length])

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
      </div>

      {/* Readout panel */}
      <div className={`fixed z-[91] w-[220px] pointer-events-auto ${CORNER_CLASS[corner]}`}>
        <div className="bg-onyx-deep/95 border border-amber-gold backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 px-2 h-7 border-b border-amber-gold/40">
            <span className="font-bold text-[10px] tracking-widest uppercase text-amber-gold">
              Layout Insets
            </span>
            <div className="flex items-center gap-1">
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

          <div className="p-2 space-y-1.5 text-[10px]">
            <div className="font-bold text-[9px] tracking-widest uppercase text-on-surface-variant pb-0.5">
              Safe-area insets
            </div>
            <Row label="top"    value={`${insets.top}px`} />
            <Row label="right"  value={`${insets.right}px`} />
            <Row label="bottom" value={`${insets.bottom}px`} />
            <Row label="left"   value={`${insets.left}px`} />

            <div className="font-bold text-[9px] tracking-widest uppercase text-on-surface-variant pt-1 pb-0.5 border-t border-white/10">
              Viewport
            </div>
            <Row label="window"  value={`${metrics.innerW}×${metrics.innerH}`} />
            <Row label="visual"  value={`${metrics.vvW}×${metrics.vvH}`} />
            <Row label="vv scale" value={metrics.vvScale} />
            <Row label="vv offY" value={`${metrics.vvOffsetTop}px`} />
            <Row label="screen"  value={`${metrics.screenW}×${metrics.screenH}`} />
            <Row label="dpr"     value={metrics.dpr} />

            <div className="font-bold text-[9px] tracking-widest uppercase text-on-surface-variant pt-1 pb-0.5 border-t border-white/10">
              Mode
            </div>
            <Row label="display"     value={metrics.standalone ? 'standalone' : 'browser'} />
            <Row label="orientation" value={metrics.orientation} />
          </div>
        </div>
      </div>
    </>
  )
}
