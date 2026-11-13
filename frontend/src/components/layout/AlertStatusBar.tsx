import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { Advisory, NavTab } from '../../storeTypes'

type Level = 'green' | 'yellow' | 'red'

// Defence-in-depth against feeds that leak markup (e.g. double-encoded ODOT
// TripCheck links). The poller strips these too, but this keeps the advisory
// bar clean for any source and for cached items before the next poll.
function stripMarkup(input: string): string {
  if (!input) return ''
  let text = input
  let prev = ''
  const ta = document.createElement('textarea')
  for (let i = 0; i < 3 && text !== prev; i++) {
    prev = text
    ta.innerHTML = text
    text = ta.value
  }
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const LEVEL_STYLES: Record<Level, string> = {
  green:  'bg-green-ais text-onyx-black',
  yellow: 'bg-amber-gold text-onyx-black',
  red:    'bg-red-emergency text-white shadow-red-glow',
}

const LEVEL_LABELS: Record<Level, string> = {
  green:  'ALL CLEAR',
  yellow: 'ADVISORY',
  red:    'EMERGENCY',
}

const LEVEL_ICONS: Record<Level, string> = {
  green:  'check_circle',
  yellow: 'warning',
  red:    'emergency_home',
}

const SOURCE_LABELS: Record<Advisory['source'], string> = {
  radio:      'Dispatch',
  nws:        'NWS',
  traffic:    'Traffic',
  flashalert: 'FlashAlert',
  briefing:   'Briefing',
  faa:        'FAA',
  news:       'News',
}

const text = (a: Advisory) => stripMarkup(a.detail ? `${a.title} — ${a.detail}` : a.title)

/**
 * The advisory bar: the ranked advisory feed (poller
 * advisories.py — NWS warnings, nearby dispatch incidents, road closures,
 * local agency notices), coloured by the worst item. One advisory is shown
 * and opens directly; several scroll past as a ticker (hover pauses) and a tap
 * opens the list.
 */
export function AlertStatusBar() {
  const { mode, advisories, setActiveTab, setFocusIncidentId } = useCivicPick('mode', 'advisories', 'setActiveTab', 'setFocusIncidentId')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  // A single advisory scrolls only when it doesn't fit the bar; a ticker always does.
  const [overflows, setOverflows] = useState(false)
  const [boxWidth, setBoxWidth] = useState(0)

  const items = advisories?.items ?? []
  const count = advisories?.count ?? 0
  const level: Level = advisories?.level === 'red' ? 'red' : advisories?.level === 'amber' ? 'yellow' : 'green'
  // With several advisories the bar is a ticker: every one scrolls past in rank order (the colour stays that of the
  // worst one). Hovering pauses it; tapping opens the list. A single advisory is shown as before and opens directly.
  const [held, setHeld] = useState(false)
  const top = items[0]
  const ticker = items.length > 1
  const message = useMemo(
    () => (items.length ? items.map(text).join('   •   ') : 'No active advisories'),
    [items],
  )

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  useEffect(() => { if (count <= 1) setOpen(false) }, [count])

  useLayoutEffect(() => {
    const box = boxRef.current
    const text = measureRef.current
    if (!box || !text) return
    const check = () => { setOverflows(text.offsetWidth > box.clientWidth); setBoxWidth(box.clientWidth) }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    return () => ro.disconnect()
  }, [message])

  // One loop moves the text by one copy: ~6 characters a second reads comfortably.
  const animationDuration = useMemo(() => `${Math.max(12, Math.round(message.length / (ticker ? 8 : 6)))}s`, [message])

  // A ticker that fits still scrolls: each copy is at least one bar wide so the loop has no gap.
  const loopWidth = overflows ? undefined : { minWidth: boxWidth }

  const go = (a: Advisory) => {
    setOpen(false)
    if (a.target.incident) setFocusIncidentId(a.target.incident)
    setActiveTab(a.target.tab as NavTab)
  }

  // In calm mode show a slim indicator; in critical mode show the full bar
  if (mode === 'calm' && level === 'green') return null

  return (
    <div ref={rootRef} className="relative shrink-0 z-20">
      <div
        className={`
          w-full flex items-center transition-all duration-300
          ${LEVEL_STYLES[level]}
          ${mode === 'critical' ? 'h-8 text-[11px]' : 'h-6 text-[11px]'}
        `}
      >
        <button
          type="button"
          onClick={() => (ticker ? setOpen((o) => !o) : top && go(top))}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          role="alert"
          aria-live={items.length > 1 ? 'off' : 'assertive'}   // a rotating message would otherwise be re-announced every few seconds
          aria-label={ticker ? `${items.length} advisories: ${message}` : top ? `Open advisory: ${message}` : 'No active advisories'}
          className="flex-1 min-w-0 h-full flex items-center gap-3 pl-4 pr-2 text-left"
        >
          <span
            className="ms text-[14px] leading-none"
            aria-hidden="true"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            {LEVEL_ICONS[level]}
          </span>
          <span className="font-bold tracking-widest uppercase shrink-0">
            {LEVEL_LABELS[level]}
          </span>
          <div ref={boxRef} className="relative flex-1 min-w-0 overflow-hidden">
            {/* Off-screen copy used to measure the message's natural width. */}
            <span ref={measureRef} className="absolute invisible whitespace-nowrap font-mono" aria-hidden="true">{message}</span>
            {overflows || ticker ? (
              <span
                key={items.map((i) => i.id).join('|')}
                className="alert-marquee-track font-mono opacity-80"
                style={{ animationDuration, animationPlayState: held ? 'paused' : 'running' }}
              >
                <span className="alert-marquee-item" style={loopWidth}>{message}</span>
                <span className="alert-marquee-item" style={loopWidth} aria-hidden="true">{message}</span>
              </span>
            ) : (
              <span className="block truncate font-mono opacity-80">{message}</span>
            )}
          </div>
        </button>

        {count > 1 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`${count - 1} more advisories`}
            className="shrink-0 h-full flex items-center gap-0.5 px-3 font-mono font-bold border-l border-black/15 hover:bg-black/10"
          >
            +{count - 1}
            <span className="ms text-[16px] leading-none" aria-hidden="true">{open ? 'expand_less' : 'expand_more'}</span>
          </button>
        )}
      </div>

      {open && (
        <ul className="absolute left-0 right-0 lg:left-auto lg:w-md top-full z-50 max-h-[60vh] overflow-y-auto bg-onyx-deep border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] divide-y divide-white/5">
          {items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => go(a)} className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-white/5">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${a.level === 'red' ? 'bg-red-emergency' : 'bg-amber-gold'}`} aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-bold text-on-surface truncate">{stripMarkup(a.title)}</span>
                  {a.detail && <span className="block text-[11px] text-on-surface-variant line-clamp-2">{stripMarkup(a.detail)}</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant border border-white/10 px-1">
                  {SOURCE_LABELS[a.source] ?? a.source}
                </span>
              </button>
            </li>
          ))}
          {count > items.length && (
            <li className="px-4 py-2 text-[11px] text-on-surface-variant">+{count - items.length} lower-ranked not shown</li>
          )}
        </ul>
      )}
    </div>
  )
}
