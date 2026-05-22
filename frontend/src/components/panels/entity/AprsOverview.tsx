import type { OverviewProps } from './AircraftOverview'

const STATION_TYPE_COLORS: Record<string, string> = {
  mobile:         'text-amber-gold bg-amber-gold/10',
  weather:        'text-sky-400 bg-sky-400/10',
  emergency:      'text-red-400 bg-red-400/10',
  infrastructure: 'text-purple-400 bg-purple-400/10',
  aircraft:       'text-cyan-400 bg-cyan-400/10',
  marine:         'text-blue-400 bg-blue-400/10',
  fixed:          'text-green-400 bg-green-400/10',
}

function WindArrow({ deg }: { deg: number }) {
  return (
    <span
      className="ms text-[14px] inline-block"
      style={{ transform: `rotate(${deg}deg)`, display: 'inline-block' }}
    >
      arrow_upward
    </span>
  )
}

export function AprsOverview({ entity, getIdentity }: OverviewProps) {
  const stationType = getIdentity('station_type')
  const symDesc = getIdentity('symbol_desc')

  const wx = stationType === 'weather'
    ? (entity.identity as Record<string, unknown>)?.wx as Record<string, unknown> | undefined
    : undefined

  const identityRows: [string, string | undefined][] = [
    ['Type',    entity.entity_type],
    ['Source',  entity.source],
    ['Callsign', getIdentity('callsign') ?? entity.display_name],
    ['Symbol',  getIdentity('symbol')],
    ['Path',    getIdentity('path')],
    ['Comment', getIdentity('comment') ?? getIdentity('message')],
  ]

  return (
    <>
      {(stationType || symDesc) && (
        <div className="flex items-center gap-2 mb-2">
          {stationType && (
            <span className={`label-caps text-[11px] px-1.5 py-0.5 rounded-sm border border-white/10 ${STATION_TYPE_COLORS[stationType] ?? 'text-on-surface-variant bg-white/5'}`}>
              {stationType}
            </span>
          )}
          {symDesc && (
            <span className="text-[11px] text-on-surface-variant truncate">{symDesc}</span>
          )}
        </div>
      )}

      {/* Weather data card — only for weather stations with wx data */}
      {wx && (
        <div className="bg-white/5 border border-white/10 rounded-sm p-2 mb-3 space-y-2">
          <span className="label-caps text-[11px] text-sky-400/80 block">Live Conditions</span>
          <div className="grid grid-cols-2 gap-2">
            {typeof wx.temp_f === 'number' && (
              <div>
                <div className="flex items-center gap-1 text-on-surface-variant mb-0.5">
                  <span className="ms text-[12px]">thermometer</span>
                  <span className="label-caps text-[10px]">Temp</span>
                </div>
                <span className="font-mono text-[14px] text-sky-300">
                  {wx.temp_f}°F
                </span>
              </div>
            )}
            {typeof wx.humidity === 'number' && (
              <div>
                <div className="flex items-center gap-1 text-on-surface-variant mb-0.5">
                  <span className="ms text-[12px]">water_drop</span>
                  <span className="label-caps text-[10px]">Humidity</span>
                </div>
                <span className="font-mono text-[14px] text-sky-300">
                  {wx.humidity}%
                </span>
              </div>
            )}
            {typeof wx.wind_mph === 'number' && (
              <div>
                <div className="flex items-center gap-1 text-on-surface-variant mb-0.5">
                  <span className="ms text-[12px]">air</span>
                  <span className="label-caps text-[10px]">Wind</span>
                </div>
                <span className="font-mono text-[14px] text-sky-300 flex items-center gap-1">
                  {typeof wx.wind_dir_deg === 'number' && <WindArrow deg={wx.wind_dir_deg as number} />}
                  {wx.wind_mph} mph
                  {typeof wx.gust_mph === 'number' && (
                    <span className="text-[11px] text-on-surface-variant">g{wx.gust_mph}</span>
                  )}
                </span>
              </div>
            )}
            {typeof wx.pressure_mb === 'number' && (
              <div>
                <div className="flex items-center gap-1 text-on-surface-variant mb-0.5">
                  <span className="ms text-[12px]">compress</span>
                  <span className="label-caps text-[10px]">Pressure</span>
                </div>
                <span className="font-mono text-[14px] text-sky-300">
                  {(wx.pressure_mb as number).toFixed(1)} mb
                </span>
              </div>
            )}
          </div>
          {typeof wx.rain_in === 'number' && (
            <div className="flex items-center justify-between pt-1 border-t border-white/10">
              <div className="flex items-center gap-1 text-on-surface-variant">
                <span className="ms text-[12px]">rainy</span>
                <span className="label-caps text-[10px]">Rain (1h)</span>
              </div>
              <span className="font-mono text-[11px] text-sky-300">{(wx.rain_in as number).toFixed(2)}"</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 p-2 rounded-sm relative overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant relative z-10">
            <span className="ms text-[12px]">height</span>
            <span className="label-caps text-[11px]">Altitude</span>
          </div>
          <div className="font-mono text-cyan-adsb text-[14px] truncate relative z-10 [text-shadow:0_2px_4px_rgba(0,0,0,0.8),0_0_2px_rgba(0,0,0,1)]">
            {entity.altitude != null ? `${Math.round(entity.altitude).toLocaleString()} ft` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm relative overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant relative z-10">
            <span className="ms text-[12px]">speed</span>
            <span className="label-caps text-[11px]">Speed</span>
          </div>
          <div className="font-mono text-amber-gold text-[14px] truncate relative z-10 [text-shadow:0_2px_4px_rgba(0,0,0,0.8),0_0_2px_rgba(0,0,0,1)]">
            {entity.speed != null ? `${Math.round(entity.speed)} kts` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">explore</span>
            <span className="label-caps text-[11px]">Heading</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.heading != null ? `${Math.round(entity.heading)}°` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">social_distance</span>
            <span className="label-caps text-[11px]">Distance</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3 mt-3">
        <div>
          <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Identity</span>
          <div className="space-y-1">
            {identityRows.filter(([, v]) => v != null).map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] text-on-surface-variant shrink-0">{label}</span>
                <span className="font-mono text-[11px] text-on-surface text-right break-words">{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-between items-center pt-2 border-t border-white/10">
          <div className="flex items-center gap-1 text-on-surface-variant">
            <span className="ms text-[11px]">schedule</span>
            <span className="text-[11px] uppercase tracking-wider">Last Seen</span>
          </div>
          <span className="font-mono text-[11px] text-amber-gold">
            {entity.last_seen ? new Date(entity.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
          </span>
        </div>
      </div>
    </>
  )
}
