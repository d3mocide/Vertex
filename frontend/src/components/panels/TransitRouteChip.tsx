import { useCivicStore } from '../../store'
import { modeName } from './infrastructure/TransitBrowser'

/** Names the transit route drawn on the map (picked in Infrastructure) and lets the operator clear it. */
export function TransitRouteChip() {
  const detail = useCivicStore(s => s.transitBrowse)
  const setBrowse = useCivicStore(s => s.setTransitBrowse)
  if (!detail) return null
  const { route } = detail
  return (
    <div className="absolute bottom-24 lg:bottom-28 left-2 lg:left-[352px] z-30 map-overlay-card flex items-center gap-2 px-3 py-2 max-w-[calc(100%-1rem)] pointer-events-auto">
      <span className="ms text-[16px] text-amber-gold" aria-hidden="true">route</span>
      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 shrink-0"
        style={{ backgroundColor: route.color ?? undefined, color: route.text_color ?? undefined }}>{route.short_name || route.route_id}</span>
      <span className="text-[12px] text-on-surface truncate">{route.long_name || modeName(route.type)}</span>
      <button type="button" className="btn-ghost px-1 py-0.5 shrink-0" aria-label="Clear route from map" onClick={() => setBrowse(null)}>
        <span className="ms text-[14px] leading-none" aria-hidden="true">close</span>
      </button>
    </div>
  )
}
