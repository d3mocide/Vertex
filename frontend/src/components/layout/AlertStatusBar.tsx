import { useMemo } from 'react'
import { useCivicStore } from '../../store'

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

function resolveLevel(alertCount: number, hasEmergency: boolean): Level {
  if (hasEmergency || alertCount >= 3) return 'red'
  if (alertCount >= 1) return 'yellow'
  return 'green'
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

export function AlertStatusBar() {
  const { mode, alerts, weather, setActiveTab } = useCivicStore()

  const hasEmergency = weather.alerts.some(
    (a) => a.severity === 'Extreme' || a.severity === 'Severe'
  )
  const level = resolveLevel(alerts.length, hasEmergency)

  const alertItem   = alerts[0]
  const weatherAlert = weather.alerts[0]
  const advisoryTitle = alertItem?.title?.trim() ?? ''
  const advisorySummary = alertItem?.summary?.trim() ?? ''
  const weatherHeadline = weatherAlert?.headline?.trim() ?? ''
  const rawMessage = alertItem
    ? (advisorySummary ? `${advisoryTitle} - ${advisorySummary}` : advisoryTitle)
    : (weatherHeadline || 'No active alerts')
  const message = useMemo(() => stripMarkup(rawMessage), [rawMessage])

  const openDetails = () => {
    if (alertItem) {
      setActiveTab('intel')
      return
    }
    if (weatherAlert) {
      setActiveTab('incidents')
    }
  }

  // Adjust animation duration dynamically to keep a readable, constant scrolling speed
  const animationDuration = useMemo(() => {
    const charsPerSecond = 8
    const duration = message.length / charsPerSecond
    return `${Math.max(30, Math.round(duration))}s`
  }, [message])

  // In calm mode show a slim indicator; in critical mode show the full bar
  if (mode === 'calm' && level === 'green') return null

  return (
    <button
      type="button"
      onClick={openDetails}
      role="alert"
      aria-live="assertive"
      aria-label="Open advisory details"
      className={`
        w-full flex items-center gap-3 px-4 shrink-0 transition-all duration-300 text-left relative z-20
        ${LEVEL_STYLES[level]}
        ${mode === 'critical' ? 'h-8 text-[11px]' : 'h-6 text-[11px]'}
      `}
    >
      <span
        className="ms text-[14px] leading-none"
        aria-hidden="true"
        style={{ fontVariationSettings: "'FILL' 1" }}
      >
        {LEVEL_ICONS[level]}
      </span>
      <span className="font-bold tracking-widest uppercase mr-2">
        {LEVEL_LABELS[level]}
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <span 
          className="alert-marquee-track font-mono opacity-80"
          style={{ animationDuration }}
        >
          <span className="alert-marquee-item">{message}</span>
          <span className="alert-marquee-item" aria-hidden="true">{message}</span>
        </span>
      </div>

      {/* Scrolling ticker in critical mode */}
      {mode === 'critical' && alerts.length > 1 && (
        <span className="ml-auto font-mono text-[11px] opacity-70 shrink-0">
          +{alerts.length - 1} MORE
        </span>
      )}
    </button>
  )
}
