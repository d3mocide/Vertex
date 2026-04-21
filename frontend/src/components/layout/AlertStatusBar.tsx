import { useCivicStore } from '../../store'

type Level = 'green' | 'yellow' | 'red'

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
  const { mode, alerts, weather } = useCivicStore()

  const hasEmergency = weather.alerts.some(
    (a) => a.severity === 'Extreme' || a.severity === 'Severe'
  )
  const level = resolveLevel(alerts.length, hasEmergency)

  const alertItem   = alerts[0]
  const weatherAlert = weather.alerts[0]
  const message = alertItem?.title ?? weatherAlert?.headline ?? 'No active alerts'

  // In calm mode show a slim indicator; in critical mode show the full bar
  if (mode === 'calm' && level === 'green') return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`
        w-full flex items-center gap-3 px-4 shrink-0 transition-all duration-300
        ${LEVEL_STYLES[level]}
        ${mode === 'critical' ? 'h-8 text-[11px]' : 'h-6 text-[10px]'}
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
      <span className="font-mono truncate opacity-80">{message}</span>

      {/* Scrolling ticker in critical mode */}
      {mode === 'critical' && alerts.length > 1 && (
        <span className="ml-auto font-mono text-[9px] opacity-70 shrink-0">
          +{alerts.length - 1} MORE
        </span>
      )}
    </div>
  )
}
