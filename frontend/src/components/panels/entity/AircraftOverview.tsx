import type { Entity } from '../../../storeTypes'

export interface OverviewProps {
  entity: Entity
  getIdentity: (key: string) => string | undefined
  trail?: { altitude?: number | null; speed?: number | null }[]
}

/** Render a responsive SVG sparkline from a numeric series. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const h = 24
  
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${values.length - 1} ${h}`} preserveAspectRatio="none" aria-hidden="true" className="block">
      <polyline
        points={values.map((v, i) => `${i},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

const EMERGENCY_SQUAWKS: Record<string, { label: string; urgent: boolean }> = {
  '7500': { label: 'HIJACK', urgent: true },
  '7600': { label: 'NORDO',  urgent: false },
  '7700': { label: 'EMERGENCY', urgent: true },
}

export function AircraftOverview({ entity, getIdentity, trail = [] }: OverviewProps) {
  const squawk = getIdentity('squawk')
  const squawkAlert = squawk ? EMERGENCY_SQUAWKS[squawk] : undefined

  const identityRows: [string, string | undefined][] = [
    ['Type',    entity.entity_type],
    ['Source',  entity.source],
    ['ICAO24',  getIdentity('icao24')],
    ['Callsign', getIdentity('callsign')],
    ['Reg', getIdentity('registration')],
    ['Operator', getIdentity('operator')],
    ['Aircraft', getIdentity('type')],
  ]

  const routeRows: [string, string | undefined][] = [
    ['Origin', getIdentity('origin')],
    ['Dest', getIdentity('destination')],
    ['Phase', getIdentity('phase')],
    ['Status',  entity.status],
  ]

  const altitudes = trail.map(p => p.altitude).filter((v): v is number => typeof v === 'number')
  const speeds = trail.map(p => p.speed).filter((v): v is number => typeof v === 'number')

  const vr = entity.vertical_rate
  const vrColor = vr == null ? 'text-on-surface' : vr > 100 ? 'text-green-500' : vr < -100 ? 'text-red-400' : 'text-on-surface'
  const vrArrow = vr == null ? '' : vr > 100 ? '↑' : vr < -100 ? '↓' : '→'

  return (
    <>
      {/* Emergency squawk banner */}
      {squawkAlert && (
        <div className={`flex items-center gap-2 px-2 py-1.5 rounded-sm border animate-pulse ${
          squawkAlert.urgent
            ? 'bg-red-emergency/20 border-red-emergency text-red-emergency'
            : 'bg-amber-gold/20 border-amber-gold text-amber-gold'
        }`}>
          <span className="ms text-[14px] leading-none">warning</span>
          <span className="font-mono text-[11px] font-bold tracking-wider">
            SQUAWK {squawk} — {squawkAlert.label}
          </span>
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
          {altitudes.length >= 3 && (
            <div className="absolute bottom-0 left-0 right-0 opacity-30 z-0">
              <Sparkline values={altitudes} color="rgb(var(--color-cyan-adsb, 0 200 255))" />
            </div>
          )}
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm relative overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant relative z-10">
            <span className="ms text-[12px]">speed</span>
            <span className="label-caps text-[11px]">Speed</span>
          </div>
          <div className="font-mono text-amber-gold text-[14px] truncate relative z-10 [text-shadow:0_2px_4px_rgba(0,0,0,0.8),0_0_2px_rgba(0,0,0,1)]">
            {entity.speed != null ? `${Math.round(entity.speed)} kts` : '--'}
          </div>
          {speeds.length >= 3 && (
            <div className="absolute bottom-0 left-0 right-0 opacity-30 z-0">
              <Sparkline values={speeds} color="rgb(var(--color-amber-gold, 255 184 0))" />
            </div>
          )}
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
            <span className="ms text-[12px]">swap_vert</span>
            <span className="label-caps text-[11px]">Vert Rate</span>
          </div>
          <div className={`font-mono text-[12px] ${vrColor}`}>
            {vr != null ? `${vrArrow} ${Math.abs(Math.round(vr))} ft/m` : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Identity</span>
          <div className="space-y-1">
            {squawk && !squawkAlert && (
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] text-on-surface-variant">Squawk</span>
                <span className="font-mono text-[11px] text-on-surface">{squawk}</span>
              </div>
            )}
            {identityRows.filter(([, v]) => v != null).map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] text-on-surface-variant">{label}</span>
                <span className="font-mono text-[11px] text-on-surface truncate">{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Routing</span>
          <div className="space-y-1">
            {routeRows.filter(([, v]) => v != null).map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[11px] text-on-surface-variant">{label}</span>
                <span className="font-mono text-[11px] text-on-surface truncate">{val}</span>
              </div>
            ))}
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[11px] text-on-surface-variant">Distance</span>
              <span className="font-mono text-[11px] text-on-surface">
                {entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : '--'}
              </span>
            </div>
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
