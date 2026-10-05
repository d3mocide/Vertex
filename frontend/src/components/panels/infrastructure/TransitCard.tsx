import { useCapabilities } from '../../../hooks/useCapabilities'
import { useCivicStore } from '../../../store'
import { RegionalFeedStatus } from '../../common/RegionalFeedStatus'

export function TransitCard() {
  const caps = useCapabilities()
  const entities = useCivicStore(s => s.entities)
  const filters = useCivicStore(s => s.entityFilter)
  const setFilter = useCivicStore(s => s.setEntityFilter)
  const live = Object.values(entities).filter(e => e.source.startsWith('gtfs_'))
  const routes = caps?.contracts['transit.routes']
  if (!routes || (Object.values(routes.provider_statuses ?? {}).length > 0 && Object.values(routes.provider_statuses ?? {}).every(p => p.reason === 'outside_coverage')) || routes.reason === 'no_pack' || routes.reason === 'not_in_pack') return null
  return (
    <section className="hud-panel p-4 stack-y-3">
      <h2 className="section-heading flex items-center gap-2"><span className="ms" aria-hidden="true">directions_bus</span>Local Transit</h2>
      <p className="text-[12px] text-on-surface-variant">Vehicles are limited to the monitoring area. Route schedules can be available without live positions.</p>
      <div className="flex gap-3">
        <button className="btn-ghost" aria-pressed={filters.bus} onClick={() => setFilter({ bus: !filters.bus })}>Buses <span className="font-mono">{live.filter(e => e.entity_type === 'bus').length}</span></button>
        <button className="btn-ghost" aria-pressed={filters.train} onClick={() => setFilter({ train: !filters.train })}>Trains <span className="font-mono">{live.filter(e => e.entity_type === 'train').length}</span></button>
      </div>
      <RegionalFeedStatus contracts={['transit.routes', 'transit.vehicles']} />
      {Object.entries(routes.provider_statuses ?? {}).filter(([, p]) => p.reason !== 'outside_coverage').map(([id, p]) => (
        <p key={id} className="text-[12px] text-on-surface-variant">
          {id === 'trimet-transit' ? 'TriMet' : id === 'cherriots-transit' ? 'Cherriots' : id === 'ctran-transit' ? 'C-TRAN' : 'Sound Transit'}
          {' · '}{p.reason === 'access_unverified' ? 'Supported access pending' : p.reason === 'not_configured' ? 'Developer key required' : p.reason === 'disabled' ? 'Disabled in configuration' : p.status === 'ok' ? 'Route data available' : p.status === 'pending' ? 'Waiting for route data' : 'Route updates delayed'}
          {id === 'cherriots-transit' && ' · Schedules only'}
        </p>
      ))}
    </section>
  )
}
