import type { OverviewProps } from './AircraftOverview'

const ROUTE_TYPES: Record<number, string> = {
  0: 'Tram / Streetcar',
  1: 'Light Rail',
  2: 'Rail',
  3: 'Bus',
  4: 'Ferry',
}

// Amtrak event codes
const AMTRAK_STATUS: Record<string, string> = {
  'DP': 'Departed',
  'AR': 'Arrived',
  'EN': 'En Route',
  'SB': 'Standby',
  'SK': 'Skipped',
}

const AMTRAK_STATUS_COLOR: Record<string, string> = {
  'DP': 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  'AR': 'text-sky-400    border-sky-500/40    bg-sky-500/10',
  'EN': 'text-amber-400  border-amber-500/40  bg-amber-500/10',
  'SB': 'text-gray-400   border-white/20      bg-white/5',
  'SK': 'text-red-400    border-red-500/40    bg-red-500/10',
}

function statusBadge(code: string | undefined | null) {
  if (!code) return null
  const key = code.toUpperCase()
  const label = AMTRAK_STATUS[key] ?? code
  const cls   = AMTRAK_STATUS_COLOR[key] ?? 'text-gray-400 border-white/20 bg-white/5'
  return (
    <span className={`text-[11px] font-mono border px-1.5 py-0.5 rounded-sm ${cls}`}>
      {label}
    </span>
  )
}

export function TrainOverview({ entity, getIdentity }: OverviewProps) {
  const isAmtrak = entity.source === 'amtrak'

  // Amtrak identity
  const trainNumber  = getIdentity('train_number')
  const trainName    = getIdentity('train_name')
  const routeName    = getIdentity('route_name')
  const origin       = getIdentity('origin')
  const destination  = getIdentity('destination')
  const direction    = getIdentity('direction')
  const lastReported = getIdentity('last_reported')

  // GTFS-RT identity
  const vehicleLabel   = getIdentity('vehicle_label') ?? getIdentity('vehicle_id')
  const routeShortName = getIdentity('route_short_name')
  const routeLongName  = getIdentity('route_long_name')
  const routeTypeRaw   = entity.identity?.route_type
  const routeType      = typeof routeTypeRaw === 'number' ? routeTypeRaw : null
  const tripId         = getIdentity('trip_id')
  const feedLabel      = getIdentity('feed_label')

  const routeLabel = routeShortName
    ? `${routeShortName}${routeLongName ? ` — ${routeLongName}` : ''}`
    : routeLongName

  return (
    <>
      {/* Speed / Heading stat tiles */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">speed</span>
            <span className="label-caps text-[11px]">Speed</span>
          </div>
          <div className="font-mono text-amber-gold text-[14px] truncate [text-shadow:0_2px_4px_rgba(0,0,0,0.8),0_0_2px_rgba(0,0,0,1)]">
            {entity.speed != null ? `${Math.round(entity.speed)} kts` : '--'}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">explore</span>
            <span className="label-caps text-[11px]">Heading</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.heading != null
              ? `${Math.round(entity.heading)}°`
              : direction ?? '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3 mt-3">

        {/* ── Amtrak identity ──────────────────────────────────────── */}
        {isAmtrak && (
          <>
            <div>
              <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Train</span>
              <div className="space-y-1">
                {([
                  ['Number', trainNumber],
                  ['Name',   trainName],
                  ['Route',  routeName],
                  ['Source', entity.source],
                ] as [string, string | undefined][]).filter(([, v]) => v != null).map(([label, val]) => (
                  <div key={label} className="flex justify-between items-baseline gap-2">
                    <span className="text-[11px] text-on-surface-variant">{label}</span>
                    <span className="font-mono text-[11px] text-on-surface truncate" title={val}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {(origin || destination || entity.status) && (
              <div>
                <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Route</span>
                <div className="space-y-1.5">
                  {(origin || destination) && (
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="text-on-surface-variant shrink-0">{origin ?? '?'}</span>
                      <span className="ms text-[14px] text-amber-gold-dim shrink-0">arrow_forward</span>
                      <span className="text-on-surface truncate">{destination ?? '?'}</span>
                    </div>
                  )}
                  {entity.status && (
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-[11px] text-on-surface-variant">Status</span>
                      {statusBadge(entity.status)}
                    </div>
                  )}
                  {lastReported && (
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-[11px] text-on-surface-variant">Reported</span>
                      <span className="font-mono text-[11px] text-on-surface truncate">{lastReported}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── GTFS-RT identity ─────────────────────────────────────── */}
        {!isAmtrak && (
          <>
            <div>
              <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Vehicle</span>
              <div className="space-y-1">
                {([
                  ['ID',     vehicleLabel],
                  ['Route',  routeLabel],
                  ['Type',   routeType != null ? (ROUTE_TYPES[routeType] ?? String(routeType)) : undefined],
                  ['Feed',   feedLabel],
                  ['Source', entity.source],
                ] as [string, string | undefined][]).filter(([, v]) => v != null).map(([label, val]) => (
                  <div key={label} className="flex justify-between items-baseline gap-2">
                    <span className="text-[11px] text-on-surface-variant">{label}</span>
                    <span className="font-mono text-[11px] text-on-surface truncate" title={val}>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {tripId && (
              <div>
                <span className="label-caps text-[11px] text-amber-gold-dim mb-1 block">Trip</span>
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[11px] text-on-surface-variant">Trip ID</span>
                  <span className="font-mono text-[11px] text-on-surface truncate">{tripId}</span>
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex justify-between items-center pt-2 border-t border-white/10">
          <div className="flex items-center gap-1 text-on-surface-variant">
            <span className="ms text-[11px]">schedule</span>
            <span className="text-[11px] uppercase tracking-wider">Last Seen</span>
          </div>
          <span className="font-mono text-[11px] text-amber-gold">
            {entity.last_seen
              ? new Date(entity.last_seen).toLocaleTimeString('en-US', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })
              : '--'}
          </span>
        </div>
      </div>
    </>
  )
}
