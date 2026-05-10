import type { OverviewProps } from './AircraftOverview'

const NAV_STATUS_COLORS: Record<string, string> = {
  'Under Way Using Engine':   'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  'At Anchor':                'text-amber-400 border-amber-500/40 bg-amber-500/10',
  'Not Under Command':        'text-red-400 border-red-500/40 bg-red-500/10',
  'Restricted Manoeuvrability': 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  'Constrained By Her Draught': 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  'Moored':                   'text-sky-400 border-sky-500/40 bg-sky-500/10',
  'Aground':                  'text-red-400 border-red-500/40 bg-red-500/10',
  'Engaged In Fishing':       'text-teal-400 border-teal-500/40 bg-teal-500/10',
  'Under Way Sailing':        'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
}

function navStatusClass(status: string | undefined): string {
  if (!status) return 'text-gray-400 border-white/20 bg-white/5'
  for (const [key, cls] of Object.entries(NAV_STATUS_COLORS)) {
    if (status.toLowerCase().includes(key.toLowerCase())) return cls
  }
  return 'text-gray-400 border-white/20 bg-white/5'
}

export function VesselOverview({ entity, getIdentity }: OverviewProps) {
  const draughtVal = getIdentity('draught')
  const lengthVal = getIdentity('length_m')
  const widthVal = getIdentity('width_m')

  const identityRows: [string, string | undefined][] = [
    ['Type',        entity.entity_type],
    ['Source',      entity.source],
    ['MMSI',        getIdentity('mmsi')],
    ['IMO',         getIdentity('imo')],
    ['Name',        getIdentity('shipname') ?? getIdentity('name') ?? getIdentity('display_name') ?? entity.display_name],
    ['Callsign',    getIdentity('callsign')],
    ['Vessel Type', getIdentity('ship_type') ?? getIdentity('type')],
    ['Cargo',       getIdentity('cargo_type') ?? getIdentity('cargo')],
    ['Draught',     draughtVal != null ? `${draughtVal} m` : undefined],
    ['Dimensions',  lengthVal != null || widthVal != null
                      ? `${lengthVal ?? '?'} × ${widthVal ?? '?'} m`
                      : undefined],
  ]

  const navStatus = getIdentity('nav_status') ?? entity.status

  const routeRows: [string, string | undefined][] = [
    ['Destination', getIdentity('destination')],
    ['ETA',         getIdentity('eta')],
  ]

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 p-2 rounded-sm relative overflow-hidden">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant relative z-10">
            <span className="ms text-[12px]">speed</span>
            <span className="label-caps text-[8px]">Speed (SOG)</span>
          </div>
          <div className="font-mono text-amber-gold text-[14px] truncate relative z-10 [text-shadow:0_2px_4px_rgba(0,0,0,0.8),0_0_2px_rgba(0,0,0,1)]">
            {entity.speed != null ? `${Math.round(entity.speed)} kts` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">explore</span>
            <span className="label-caps text-[8px]">Course (COG)</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.heading != null ? `${Math.round(entity.heading)}°` : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3 mt-3">
        <div>
          <span className="label-caps text-[9px] text-amber-gold-dim mb-1 block">Identity</span>
          <div className="space-y-1">
            {identityRows.filter(([, v]) => v != null).map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant">{label}</span>
                <span className="font-mono text-[10px] text-on-surface truncate" title={val}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="label-caps text-[9px] text-amber-gold-dim mb-1 block">Routing</span>
          <div className="space-y-1">
            {navStatus && (
              <div className="flex justify-between items-center gap-2">
                <span className="text-[9px] text-on-surface-variant">Nav Status</span>
                <span className={`text-[9px] font-mono border px-1.5 py-0.5 rounded-sm ${navStatusClass(navStatus)}`}>
                  {navStatus}
                </span>
              </div>
            )}
            {routeRows.filter(([, v]) => v != null).map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant">{label}</span>
                <span className="font-mono text-[10px] text-on-surface truncate" title={val}>{val}</span>
              </div>
            ))}
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[9px] text-on-surface-variant">Distance</span>
              <span className="font-mono text-[10px] text-on-surface">
                {entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : '--'}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center pt-2 border-t border-white/10">
          <div className="flex items-center gap-1 text-on-surface-variant">
            <span className="ms text-[10px]">schedule</span>
            <span className="text-[9px] uppercase tracking-wider">Last Seen</span>
          </div>
          <span className="font-mono text-[10px] text-amber-gold">
            {entity.last_seen ? new Date(entity.last_seen).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
          </span>
        </div>
      </div>
    </>
  )
}
