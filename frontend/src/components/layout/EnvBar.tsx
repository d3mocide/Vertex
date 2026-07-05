import { useCivicPick } from '../../store'
import { DEFAULT_CENTER } from '../../config'

function aqiColor(aqi: number | undefined): string {
  if (aqi == null) return 'text-on-surface-variant'
  if (aqi <= 50)  return 'text-green-ais'
  if (aqi <= 100) return 'text-amber-gold'
  if (aqi <= 150) return 'text-amber-p25'
  return 'text-red-emergency'
}

function aqiLabel(aqi: number | undefined, label: string | undefined): string {
  if (label) return label.toUpperCase()
  if (aqi == null) return '—'
  if (aqi <= 50)  return 'GOOD'
  if (aqi <= 100) return 'MODERATE'
  if (aqi <= 150) return 'UNHEALTHY (SENS)'
  return 'UNHEALTHY'
}

function formatCoord(val: number, pos: string, neg: string): string {
  const dir = val >= 0 ? pos : neg
  return `${Math.abs(val).toFixed(3)}${dir}`
}

export function EnvBar() {
  const { weather, mode } = useCivicPick('weather', 'mode')
  const [centerLon, centerLat] = DEFAULT_CENTER

  // In critical mode, highlight the entire bar if severe alerts exist
  const hasSevere = weather.alerts.some(
    (a) => a.severity === 'Extreme' || a.severity === 'Severe'
  )

  const topAlert = weather.alerts[0]

  return (
    <div
      className={`
        border-b shrink-0 relative transition-all duration-500
        h-10 px-3 lg:px-6 py-0
        transition-all duration-500
        ${hasSevere && mode === 'critical'
          ? 'bg-red-emergency/5 border-red-emergency/20 backdrop-blur-md'
          : 'bg-white/[0.02] backdrop-blur-md border-white/5 shadow-inner'}
      `}
      role="region"
      aria-label="Environmental sensor data"
    >
      {/* Subtle top light for depth */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent pointer-events-none" />

      {/* Mobile: single-row compact strip */}
      <div className="lg:hidden w-full h-full flex items-center gap-3 overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-1 shrink-0">
          <span className="ms text-[12px] text-amber-gold leading-none" aria-hidden="true">air</span>
          <span className="label-caps">AQI</span>
          <span className={`font-mono text-[11px] font-bold ${aqiColor(weather.aqi)}`}>
            {weather.aqi != null ? weather.aqi : '—'}
          </span>
        </div>

        <span className="h-3 w-px bg-white/10 shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-1 shrink-0">
          <span className="ms text-[12px] text-amber-gold leading-none" aria-hidden="true">device_thermostat</span>
          <span className="label-caps">TEMP</span>
          <span className="font-mono text-[11px] text-on-surface">
            {weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '—'}
          </span>
        </div>

        <span className="h-3 w-px bg-white/10 shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-1 shrink-0">
          <span className="ms text-[12px] text-amber-gold leading-none" aria-hidden="true">air</span>
          <span className="label-caps">WIND</span>
          <span className="font-mono text-[11px] text-on-surface">
            {weather.wind_mph != null ? `${Math.round(weather.wind_mph)} MPH` : '—'}
          </span>
        </div>

        <span className="h-3 w-px bg-white/10 shrink-0" aria-hidden="true" />

        {topAlert ? (
          <div className={`flex items-center gap-1 shrink-0 ${hasSevere ? 'text-red-emergency' : 'text-amber-gold'}`} role="alert" aria-live="polite">
            <span className="ms text-[12px] leading-none" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>
              {hasSevere ? 'emergency_home' : 'warning'}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-widest">NWS ALERT</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-on-surface-variant shrink-0">
            <span className="ms text-[12px] leading-none" aria-hidden="true">check_circle</span>
            <span className="font-mono text-[11px] uppercase tracking-widest">NWS OK</span>
          </div>
        )}

      </div>

      {/* Desktop: full ticker bar */}
      <div className="hidden lg:flex items-center gap-6 h-full overflow-x-auto">
        {/* AQI */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="ms text-[14px] text-amber-gold leading-none" aria-hidden="true">air</span>
          <span className="label-caps">AQI:</span>
          <span className={`font-mono text-[11px] font-bold ${aqiColor(weather.aqi)}`}>
            {weather.aqi != null ? weather.aqi : '—'}
            {' '}
            <span className="text-[11px] opacity-80">
              ({aqiLabel(weather.aqi, weather.aqi_label)})
            </span>
          </span>
        </div>

        <div className="divider-v" aria-hidden="true" />

        {/* Temperature */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="ms text-[14px] text-amber-gold leading-none" aria-hidden="true">device_thermostat</span>
          <span className="label-caps">TEMP:</span>
          <span className="font-mono text-[11px] text-on-surface">
            {weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '—'}
          </span>
        </div>

        <div className="divider-v" aria-hidden="true" />

        {/* Wind */}
        {weather.wind_mph != null && (
          <>
            <div className="flex items-center gap-2 shrink-0">
              <span className="ms text-[14px] text-amber-gold leading-none" aria-hidden="true">air</span>
              <span className="label-caps">WIND:</span>
              <span className="font-mono text-[11px] text-on-surface">
                {Math.round(weather.wind_mph)} MPH
                {weather.wind_dir ? ` ${weather.wind_dir}` : ''}
              </span>
            </div>
            <div className="divider-v" aria-hidden="true" />
          </>
        )}

        {/* NWS alert ticker */}
        {topAlert ? (
          <div
            className={`flex items-center gap-2 shrink-0 ${hasSevere ? 'text-red-emergency' : 'text-amber-gold'}`}
            role="alert"
            aria-live="polite"
          >
            <span
              className="ms text-[14px] leading-none"
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              {hasSevere ? 'emergency_home' : 'warning'}
            </span>
            <span className="label-caps mr-1">NWS:</span>
            <span className="font-mono text-[11px] uppercase font-bold">
              {topAlert.event}
            </span>
            {topAlert.expires && (
              <span className="font-mono text-[11px] opacity-60 ml-1">
                UNTIL {new Date(topAlert.expires).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0 text-on-surface-variant">
            <span className="ms text-[14px] leading-none" aria-hidden="true">check_circle</span>
            <span className="label-caps">NWS: NO ACTIVE ALERTS</span>
          </div>
        )}

        <div className="divider-v ml-auto" aria-hidden="true" />

        {/* Region center indicator */}
        <div className="flex items-center gap-2 shrink-0 text-on-surface-variant">
          <span className="ms text-[14px] text-green-ais leading-none" aria-hidden="true">my_location</span>
          <span className="label-caps">REGION CTR:</span>
          <span className="font-mono text-[11px] text-on-surface">
            {formatCoord(centerLat, 'N', 'S')} {formatCoord(centerLon, 'E', 'W')}
          </span>
        </div>
      </div>
    </div>
  )
}
