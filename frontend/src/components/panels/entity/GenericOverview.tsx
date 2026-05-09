import type { OverviewProps } from './AircraftOverview'

export function GenericOverview({ entity, getIdentity }: OverviewProps) {
  // Extract all keys from identity that aren't already handled globally
  const identityEntries = Object.entries(entity.identity ?? {})
    .filter(([k, v]) => v != null && v !== '' && typeof v !== 'object')

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">my_location</span>
            <span className="label-caps text-[8px]">Lat / Lon</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.lat?.toFixed(4)}, {entity.lon?.toFixed(4)}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 p-2 rounded-sm">
          <div className="flex items-center gap-1.5 mb-1 text-on-surface-variant">
            <span className="ms text-[12px]">social_distance</span>
            <span className="label-caps text-[8px]">Distance</span>
          </div>
          <div className="font-mono text-on-surface text-[12px]">
            {entity.distance_km != null ? `${entity.distance_km.toFixed(1)} km` : '--'}
          </div>
        </div>
      </div>

      <div className="space-y-3 mt-3">
        <div>
          <span className="label-caps text-[9px] text-amber-gold-dim mb-1 block">Identity</span>
          <div className="space-y-1">
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[9px] text-on-surface-variant shrink-0">Type</span>
              <span className="font-mono text-[10px] text-on-surface text-right break-words">{entity.entity_type}</span>
            </div>
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-[9px] text-on-surface-variant shrink-0">Source</span>
              <span className="font-mono text-[10px] text-on-surface text-right break-words">{entity.source}</span>
            </div>
            {identityEntries.map(([label, val]) => (
              <div key={label} className="flex justify-between items-baseline gap-2">
                <span className="text-[9px] text-on-surface-variant shrink-0 capitalize">{label.replace(/_/g, ' ')}</span>
                <span className="font-mono text-[10px] text-on-surface text-right break-words">{String(val)}</span>
              </div>
            ))}
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
