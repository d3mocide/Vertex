import { useCivicStore } from '../../../store'

export function WeatherCard() {
  const weather = useCivicStore((s) => s.weather)

  const stats = [
    { label: 'Temperature', value: weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '--', icon: 'thermostat' },
    { label: 'Condition', value: weather.condition?.toUpperCase() || 'N/A', icon: 'cloud' },
    { label: 'Wind Speed', value: weather.wind_mph != null ? `${Math.round(weather.wind_mph)} MPH` : '--', icon: 'air', sub: weather.wind_dir },
    { label: 'Humidity', value: weather.humidity != null ? `${Math.round(weather.humidity)}%` : '--', icon: 'opacity' },
  ]

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative">
      <div className="label-caps mb-4 flex items-center gap-2">
        <span className="ms text-[12px] leading-none text-amber-gold" aria-hidden="true">device_thermostat</span>
        CURRENT CONDITIONS
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-sm bg-white/[0.03] flex items-center justify-center border border-white/5 group-hover:border-amber-gold/30 transition-colors">
              <span className="ms text-on-surface-variant group-hover:text-amber-gold transition-colors text-[16px]" aria-hidden="true">{s.icon}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">{s.label}</span>
              <div className="flex items-baseline gap-2 leading-none">
                <span className="text-[16px] font-black text-on-surface tracking-tight">{s.value}</span>
                {s.sub && (
                  <span className="text-[9px] font-mono text-amber-gold font-bold">{s.sub}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-[7px] font-mono text-on-surface-variant/60 uppercase tracking-widest">
          Weather Service: NOAA/NWS
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-green-ais animate-pulse" />
          <span className="text-[7px] font-mono text-on-surface-variant/60 uppercase">Data Live</span>
        </div>
      </div>
    </div>
  )
}
