import { useCivicStore } from '../../store'

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

export function EnvBar() {
  const { weather, mode } = useCivicStore()

  // In critical mode, highlight the entire bar if severe alerts exist
  const hasSevere = weather.alerts.some(
    (a) => a.severity === 'Extreme' || a.severity === 'Severe'
  )

  const topAlert = weather.alerts[0]

  return (
    <div
      className={`
        h-10 border-b flex items-center px-4 gap-6 shrink-0 overflow-x-auto
        ${hasSevere && mode === 'critical'
          ? 'bg-red-emergency-muted/40 border-red-emergency/30'
          : 'bg-onyx-black/30 backdrop-blur-sm border-amber-gold-muted/20'}
      `}
      role="region"
      aria-label="Environmental sensor data"
    >
      {/* AQI */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="ms text-[14px] text-amber-gold leading-none" aria-hidden="true">air</span>
        <span className="label-caps">AQI:</span>
        <span className={`font-mono text-[11px] font-bold ${aqiColor(weather.aqi)}`}>
          {weather.aqi != null ? weather.aqi : '—'}
          {' '}
          <span className="text-[9px] opacity-80">
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
            <span className="font-mono text-[9px] opacity-60 ml-1">
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
    </div>
  )
}
