import { useCallback } from 'react'
import { useCivicStore, WeatherAlert } from '../../store'

function AqiGauge({ aqi }: { aqi: number | undefined }) {
  if (aqi == null) return null
  const pct = Math.min(aqi / 300, 1) * 100
  const color =
    aqi <= 50  ? '#00C853' :
    aqi <= 100 ? '#FFB800' :
    aqi <= 150 ? '#FF8F00' : '#C62828'

  const label =
    aqi <= 50  ? 'Good' :
    aqi <= 100 ? 'Moderate' :
    aqi <= 150 ? 'Unhealthy (Sensitive)' : 'Unhealthy'

  return (
    <div className="hud-panel p-4 mb-4">
      <div className="label-caps mb-3">AIR QUALITY INDEX (I-5 CORRIDOR)</div>
      <div className="flex items-end gap-4 mb-3">
        <span className="font-mono text-4xl font-bold" style={{ color }}>
          {aqi}
        </span>
        <span className="font-mono text-[11px] pb-1" style={{ color }}>{label.toUpperCase()}</span>
      </div>
      {/* Bar */}
      <div className="h-2 w-full bg-surface-container-highest relative">
        <div
          className="absolute left-0 top-0 bottom-0 transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="flex justify-between mt-1 font-mono text-[8px] text-on-surface-variant">
        <span>0 GOOD</span>
        <span>100 MODERATE</span>
        <span>200 UNHEALTHY</span>
        <span>300+</span>
      </div>
    </div>
  )
}

function WeatherAlertCard({ alert }: { alert: WeatherAlert }) {
  const sevColor: Record<string, string> = {
    Extreme: 'border-red-emergency bg-red-emergency-muted/40',
    Severe:  'border-red-emergency bg-red-emergency-muted/20',
    Moderate:'border-amber-p25 bg-amber-p25-muted/20',
    Minor:   'border-amber-gold bg-amber-gold-muted/20',
  }
  const cls = sevColor[alert.severity] ?? 'border-amber-gold-muted bg-surface-container/40'

  return (
    <div className={`p-3 border mb-3 ${cls}`} role="alert">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className="ms text-[16px] leading-none text-amber-gold"
            aria-hidden="true"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            warning
          </span>
          <span className="font-bold text-[11px] text-on-surface uppercase tracking-wide">
            {alert.event}
          </span>
        </div>
        <span className="font-mono text-[9px] text-on-surface-variant shrink-0 uppercase">
          {alert.severity}
        </span>
      </div>
      <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-3">
        {alert.headline}
      </p>
      {alert.expires && (
        <div className="mt-2 font-mono text-[9px] text-on-surface-variant">
          EXPIRES: {new Date(alert.expires).toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </div>
      )}
    </div>
  )
}

function WeatherCard() {
  const { weather } = useCivicStore()

  return (
    <div className="hud-panel p-4 mb-4">
      <div className="label-caps mb-3">CURRENT CONDITIONS</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="label-caps block mb-1">TEMPERATURE</span>
          <span className="font-mono text-2xl text-on-surface font-bold">
            {weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '—'}
          </span>
        </div>
        <div>
          <span className="label-caps block mb-1">CONDITION</span>
          <span className="font-mono text-[12px] text-on-surface">
            {weather.condition ?? '—'}
          </span>
        </div>
        <div>
          <span className="label-caps block mb-1">WIND</span>
          <span className="font-mono text-[12px] text-on-surface">
            {weather.wind_mph != null
              ? `${Math.round(weather.wind_mph)} MPH ${weather.wind_dir ?? ''}`
              : '—'}
          </span>
        </div>
        <div>
          <span className="label-caps block mb-1">HUMIDITY</span>
          <span className="font-mono text-[12px] text-on-surface">
            {weather.humidity != null ? `${weather.humidity}%` : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

function RadarControls() {
  const radarVisible  = useCivicStore((s) => s.radarVisible)
  const radarOpacity  = useCivicStore((s) => s.radarOpacity)
  const setRadarVisible = useCivicStore((s) => s.setRadarVisible)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRadarOpacity(Number(e.target.value)),
    [setRadarOpacity],
  )

  return (
    <div className="hud-panel p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="label-caps">NEXRAD RADAR</div>
        <button
          onClick={() => setRadarVisible(!radarVisible)}
          className={`
            font-mono text-[9px] uppercase tracking-widest px-2 py-1 border transition-colors
            ${radarVisible
              ? 'border-green-ais text-green-ais bg-green-ais/10'
              : 'border-amber-gold-muted text-on-surface-variant bg-transparent'}
          `}
          aria-pressed={radarVisible}
        >
          {radarVisible ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className={`transition-opacity duration-200 ${radarVisible ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="label-caps text-[9px]">OPACITY</span>
          <span className="font-mono text-[9px] text-on-surface-variant">
            {Math.round(radarOpacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={radarOpacity}
          onChange={handleOpacity}
          className="w-full accent-green-ais"
          aria-label="Radar opacity"
        />
      </div>

      <div className="mt-3 font-mono text-[9px] text-on-surface-variant">
        CONUS N0Q · IEM NEXRAD · 5 MIN REFRESH
      </div>
    </div>
  )
}

export function EnvironmentPanel() {
  const { weather } = useCivicStore()

  return (
    <div
      className="relative w-full h-full bg-onyx-black/95 backdrop-blur-sm z-10 flex flex-col overflow-hidden"
      role="region"
      aria-label="Environment panel"
    >

      {/* Panel header */}
      <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center gap-3 shrink-0">
        <span
          className="ms text-[18px] text-amber-gold leading-none"
          aria-hidden="true"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          eco
        </span>
        <h2 className="font-bold text-sm uppercase tracking-tight text-on-surface">
          Environment Monitor
        </h2>
        <span className="ml-auto font-mono text-[9px] text-on-surface-variant uppercase">
          NWS · EPA · Local Sensors
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-6 content-start">

        {/* Left column */}
        <div>
          <AqiGauge aqi={weather.aqi} />
          <WeatherCard />
          <RadarControls />
        </div>

        {/* Right column — NWS alerts */}
        <section aria-labelledby="nws-heading">
          <h3 id="nws-heading" className="section-heading mb-3">
            <span className="ms text-[14px] leading-none" aria-hidden="true">thunderstorm</span>
            NWS Weather Alerts
          </h3>

          {weather.alerts.length === 0 ? (
            <div className="hud-panel p-6 flex flex-col items-center gap-3">
              <span
                className="ms text-[40px] text-green-ais"
                aria-hidden="true"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check_circle
              </span>
              <p className="font-mono text-[11px] text-on-surface-variant text-center uppercase tracking-widest">
                No active weather alerts
              </p>
            </div>
          ) : (
            weather.alerts.map((alert, i) => (
              <WeatherAlertCard key={i} alert={alert} />
            ))
          )}

          {/* Hazard quick cards */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { icon: 'ac_unit',   label: 'Freeze',  active: weather.alerts.some((a) => /freeze|frost/i.test(a.event)) },
              { icon: 'water',     label: 'Flood',   active: weather.alerts.some((a) => /flood/i.test(a.event))        },
              { icon: 'tornado',   label: 'Wind',    active: weather.alerts.some((a) => /wind/i.test(a.event))         },
            ].map((h) => (
              <div
                key={h.label}
                className={`
                  p-3 border flex flex-col items-center gap-1.5 text-center
                  ${h.active ? 'border-amber-gold bg-amber-gold-muted/30' : 'border-amber-gold-muted/30 bg-surface-container/40'}
                `}
                role="status"
                aria-label={`${h.label} hazard: ${h.active ? 'active' : 'none'}`}
              >
                <span
                  className={`ms text-[24px] leading-none ${h.active ? 'text-amber-gold' : 'text-on-surface-variant'}`}
                  aria-hidden="true"
                  style={{ fontVariationSettings: `'FILL' ${h.active ? 1 : 0}` }}
                >
                  {h.icon}
                </span>
                <span className="label-caps text-[9px]">{h.label}</span>
                <span className={`font-mono text-[9px] font-bold ${h.active ? 'text-amber-gold' : 'text-on-surface-variant'}`}>
                  {h.active ? 'ADVISORY' : 'NONE'}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
