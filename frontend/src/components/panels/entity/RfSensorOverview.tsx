import type { OverviewProps } from './AircraftOverview'

const SENSOR_FIELDS: { key: string; label: string; unit: string; icon: string }[] = [
  { key: 'temperature_C', label: 'Temperature', unit: '°C',    icon: 'thermometer' },
  { key: 'temperature_F', label: 'Temp (°F)',   unit: '°F',    icon: 'thermometer' },
  { key: 'humidity',      label: 'Humidity',    unit: '%',     icon: 'humidity_percentage' },
  { key: 'pressure_hPa',  label: 'Pressure',    unit: ' hPa',  icon: 'compress' },
  { key: 'wind_speed_km_h', label: 'Wind Speed', unit: ' km/h', icon: 'air' },
  { key: 'wind_avg_km_h',   label: 'Wind Avg',  unit: ' km/h', icon: 'air' },
  { key: 'wind_dir_deg',  label: 'Wind Dir',    unit: '°',     icon: 'navigation' },
  { key: 'rain_mm',       label: 'Rain',        unit: ' mm',   icon: 'water_drop' },
  { key: 'uv',            label: 'UV Index',    unit: '',      icon: 'wb_sunny' },
  { key: 'lux',           label: 'Light',       unit: ' lux',  icon: 'light_mode' },
  { key: 'moisture',      label: 'Moisture',    unit: '%',     icon: 'water' },
  { key: 'depth_cm',      label: 'Depth',       unit: ' cm',   icon: 'straighten' },
  { key: 'power_W',       label: 'Power',       unit: ' W',    icon: 'bolt' },
  { key: 'energy_kWh',    label: 'Energy',      unit: ' kWh',  icon: 'electric_meter' },
  { key: 'current_A',     label: 'Current',     unit: ' A',    icon: 'electric_bolt' },
  { key: 'voltage_V',     label: 'Voltage',     unit: ' V',    icon: 'electric_bolt' },
]

export function RfSensorOverview({ entity, getIdentity }: OverviewProps) {
  const identity = entity.identity ?? {}
  const model    = getIdentity('model') ?? entity.display_name ?? entity.entity_id
  const channel  = getIdentity('channel')
  const batteryOk = identity.battery_ok

  const presentFields = SENSOR_FIELDS.filter(f => identity[f.key] != null)

  const signalQuality = typeof entity.signal_quality === 'number' ? entity.signal_quality : null

  return (
    <>
      {/* Identity row */}
      <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
        <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
          <span className="ms text-[12px]">sensors</span>
          <span className="label-caps text-[11px]">Device</span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[11px] text-on-surface-variant">Model</span>
            <span className="font-mono text-[11px] text-on-surface text-right">{model}</span>
          </div>
          {channel && (
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[11px] text-on-surface-variant">Channel</span>
              <span className="font-mono text-[11px] text-on-surface">{channel}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-[11px] text-on-surface-variant">Battery</span>
            <span className={`font-mono text-[11px] ${batteryOk === 0 ? 'text-red-emergency' : 'text-lime-rf'}`}>
              {batteryOk === 0 ? 'LOW' : batteryOk === 1 ? 'OK' : '--'}
            </span>
          </div>
          {signalQuality != null && (
            <div>
              <div className="flex justify-between mb-0.5">
                <span className="text-[11px] text-on-surface-variant">Signal</span>
                <span className="font-mono text-[11px] text-lime-rf">{Math.round(signalQuality * 100)}%</span>
              </div>
              <div className="h-1 bg-white/10 w-full overflow-hidden">
                <div
                  className="h-full bg-lime-rf transition-all"
                  style={{ width: `${Math.round(signalQuality * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sensor readings */}
      {presentFields.length > 0 && (
        <div>
          <span className="label-caps text-[11px] text-amber-gold-dim mb-2 block">Readings</span>
          <div className="grid grid-cols-2 gap-1.5">
            {presentFields.map(f => {
              const raw = identity[f.key]
              const val = typeof raw === 'number' ? raw : parseFloat(String(raw))
              return (
                <div key={f.key} className="bg-white/5 border border-white/10 p-2 rounded-sm">
                  <div className="flex items-center gap-1 mb-0.5 text-on-surface-variant">
                    <span className="ms text-[11px]">{f.icon}</span>
                    <span className="label-caps text-[10px]">{f.label}</span>
                  </div>
                  <div className="font-mono text-[13px] text-lime-rf">
                    {isNaN(val) ? '--' : `${Number.isInteger(val) ? val : val.toFixed(1)}${f.unit}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {presentFields.length === 0 && (
        <p className="text-[11px] text-on-surface-variant italic">No sensor readings in last frame.</p>
      )}

      <div className="flex justify-between items-center pt-2 border-t border-white/10">
        <div className="flex items-center gap-1 text-on-surface-variant">
          <span className="ms text-[11px]">schedule</span>
          <span className="text-[11px] uppercase tracking-wider">Last Seen</span>
        </div>
        <span className="font-mono text-[11px] text-amber-gold">
          {entity.last_seen
            ? new Date(entity.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--'}
        </span>
      </div>
    </>
  )
}
