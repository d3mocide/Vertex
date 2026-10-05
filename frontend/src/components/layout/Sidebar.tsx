import { useEffect, useState } from 'react'
import { ALT_RANGE_DEFAULT, SPD_RANGE_DEFAULT, type EntityTypeFilter, useCivicPick } from '../../store'
import { SituationRail } from './SituationRail'

const LAYERS_OPEN_KEY = 'vertex.sidebar.layersOpen'
const SIDEBAR_COLLAPSE_KEY = 'vertex.sidebar.collapsed'

function GridStatusDots({ ok }: { ok: boolean }) {
  return (
    <div className="flex gap-2">
      <div className={`w-2.5 h-2.5 rounded-full border ${ok ? 'border-amber-gold-muted opacity-20' : 'border-red-emergency opacity-60'}`} />
      <div className={`w-2.5 h-2.5 rounded-full border ${ok ? 'border-amber-gold-muted opacity-20' : 'border-amber-gold-muted opacity-20'}`} />
      <div className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-amber-gold shadow-gold-sm' : 'bg-red-emergency'}`} />
    </div>
  )
}

export function Sidebar() {
  const {
    alerts,
    health,
    entities,
    connected,
    cameras,
    weather,
    advisories,
    lightningStrikes,
    setActiveTab,
    entityFilter,
    setEntityFilter,
    setEntitySearchQuery,
    setEntityAltRange,
    setEntitySpeedRange,
    camerasVisible,
    setCamerasVisible,
    gaugesVisible,
    setGaugesVisible,
    lightningVisible,
    setLightningVisible,
    dispatchVisible,
    setDispatchVisible,
    radioIncidents,
  } = useCivicPick('alerts', 'advisories', 'health', 'entities', 'connected', 'cameras', 'weather', 'lightningStrikes', 'setActiveTab', 'entityFilter', 'setEntityFilter', 'setEntitySearchQuery', 'setEntityAltRange', 'setEntitySpeedRange', 'camerasVisible', 'setCamerasVisible', 'gaugesVisible', 'setGaugesVisible', 'lightningVisible', 'setLightningVisible', 'dispatchVisible', 'setDispatchVisible', 'radioIncidents')

  const entityList = Object.values(entities)
  const aircraft     = entityList.filter((e) => e.entity_type === 'aircraft').length
  const vessels      = entityList.filter((e) => e.entity_type === 'vessel').length
  const buses = entityList.filter((e) => e.entity_type === 'bus').length
  const trains       = entityList.filter((e) => e.entity_type === 'train').length
  const aprs         = entityList.filter((e) => e.entity_type === 'aprs').length
  const fire         = entityList.filter((e) => e.entity_type === 'fire_incident').length
  const meshNodes    = entityList.filter((e) => e.entity_type === 'mesh_node').length
  const rfSensors    = entityList.filter((e) => e.entity_type === 'rf_sensor').length
  const streamGauges = entityList.filter((e) => e.entity_type === 'stream_gauge').length
  const satellites   = entityList.filter((e) => e.entity_type === 'satellite').length
  const lightningCount = lightningStrikes.length
  // Same set the map layer draws (buildDispatchLayer): significant, located, last 6 h.
  const dispatchCount = (radioIncidents?.incidents ?? []).filter((i) => i.lat != null && i.severity >= 3
    && i.status !== 'cleared' && Date.now() - Date.parse(i.last_seen) < 6 * 3600_000).length
  const cams          = cameras.length
  const wAlerts       = weather.alerts.length
  // The advisory feed (ranked, all sources) drives the incident indicators.
  const activeInc = advisories?.count ?? 0
  const advisoryLevel = advisories?.level ?? 'green'
  const incColor = advisoryLevel === 'red' ? 'text-red-emergency' : advisoryLevel === 'amber' ? 'text-amber-gold' : 'text-on-surface-variant'

  const [layersOpen, setLayersOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LAYERS_OPEN_KEY) !== '0' } catch { return true }
  })
  useEffect(() => {
    try { localStorage.setItem(LAYERS_OPEN_KEY, layersOpen ? '1' : '0') } catch { /* storage unavailable */ }
  }, [layersOpen])
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY)
    if (stored === null) return true
    return stored === '1'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  const focusSafetyMap = () => {
    setActiveTab('safety')
    setEntitySearchQuery('')
    setEntityAltRange(ALT_RANGE_DEFAULT)
    setEntitySpeedRange(SPD_RANGE_DEFAULT)
  }

  const toggleEntityType = (key: keyof EntityTypeFilter | 'aircraft_group') => {
    focusSafetyMap()
    if (key === 'aircraft_group') {
      const nextVal = !entityFilter.aircraft
      setEntityFilter({
        aircraft: nextVal,
        adsbLocal: nextVal,
        adsbSupplement: nextVal,
      })
    } else {
      const targetKey = key as keyof EntityTypeFilter
      setEntityFilter({
        [targetKey]: !entityFilter[targetKey],
      })
    }
  }

  return (
    <aside
      className={`h-full sidebar-panel flex flex-col shrink-0 z-30 transition-all duration-300 ${sidebarCollapsed ? 'w-16' : 'w-80'}`}
      aria-label="Vertex sidebar"
    >
      {/* Brand header — logo is the sidebar collapse/expand toggle */}
      <div className={`flex items-center border-b border-white/5 bg-onyx-deep/40 backdrop-blur-md shrink-0 ${sidebarCollapsed ? 'py-4 justify-center' : 'h-16 px-5 justify-between flex-row'}`}>
        <button
          type="button"
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="flex items-center gap-3 min-w-0 opacity-90 hover:opacity-100 transition-opacity focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {/* Scope mark — Direction 07 · adopted 2026-05-01 */}
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0 text-white">
            <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
              <path d="M2 8 V2 H8"/>
              <path d="M24 2 H30 V8"/>
              <path d="M30 24 V30 H24"/>
              <path d="M8 30 H2 V24"/>
            </g>
            <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
            <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
          </svg>

          {!sidebarCollapsed && (
            <div className="flex flex-col leading-none gap-1 min-w-0 items-start">
              <span className="text-[16px] font-black tracking-wider text-white uppercase select-none leading-none">
                VERTEX
              </span>
              <span className="font-mono text-[11px] tracking-[0.2em] text-amber-gold uppercase leading-none">
                SITUATIONAL AWARENESS
              </span>
            </div>
          )}
        </button>
      </div>

      {sidebarCollapsed ? (
        <div className="flex-1 flex flex-col items-center gap-4 py-3 border-r border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('safety')}
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Overview"
            title="Overview"
          >
            <span className="ms text-[20px]" aria-hidden="true">dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('incidents')}
            className={`${incColor} hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Advisories ${activeInc}`}
            title={`Advisories: ${activeInc}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">warning</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('environment')}
            className={`${wAlerts > 0 ? 'text-amber-gold' : 'text-on-surface-variant'} hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Weather alerts ${wAlerts}`}
            title={`Weather alerts: ${wAlerts}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">cloud_alert</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('intel')}
            className={`${alerts.length > 0 ? 'text-amber-gold' : 'text-on-surface-variant'} hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Intel alerts ${alerts.length}`}
            title={`Intel alerts: ${alerts.length}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">psychology</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('comms')}
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Communications"
            title="Communications"
          >
            <span className="ms text-[20px]" aria-hidden="true">forum</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('flightlog')}
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Flight Log"
            title="Flight Log"
          >
            <span className="ms text-[20px]" aria-hidden="true">flight</span>
          </button>

          <div className="mt-2 w-8 border-t border-white/10" aria-hidden="true" />

          <div className="flex flex-col items-center gap-1.5 text-[11px] font-mono text-on-surface-variant">
            <button
              type="button"
              onClick={() => toggleEntityType('aircraft_group')}
              className={`text-cyan-adsb hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.aircraft ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle aircraft layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">flight</span>
              <span>{aircraft}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleEntityType('vessel')}
              className={`text-green-ais hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.vessel ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle vessels layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">sailing</span>
              <span>{vessels}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleEntityType('train')}
              className={`text-amber-gold hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.train ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle trains layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">directions_railway</span>
              <span>{trains}</span>
            </button>
            <button
              type="button"
              onClick={() => toggleEntityType('bus')}
              className={`text-transit-bus hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.bus ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle buses layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">directions_bus</span>
              <span>{buses}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleEntityType('aprs')}
              className={`text-violet-space hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.aprs ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle APRS layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">sensors</span>
              <span>{aprs}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleEntityType('fire_incident')}
              className={`text-red-emergency hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.fire_incident ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle hazards layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">local_fire_department</span>
              <span>{fire}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleEntityType('mesh_node')}
              className={`text-lime-rf hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.mesh_node ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle mesh nodes layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">hub</span>
              <span>{meshNodes}</span>
            </button>

            {/* Only shown when a source produces this entity type. */}

            {rfSensors > 0 && (
              <button
                type="button"
                onClick={() => toggleEntityType('rf_sensor')}
                className={`text-lime-rf hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.rf_sensor ? 'opacity-100' : 'opacity-40'}`}
                title="Toggle RF sensors layer"
              >
                <span className="ms text-[12px]" aria-hidden="true">sensors</span>
                <span>{rfSensors}</span>
              </button>

            )}

            <button
              type="button"
              onClick={() => { focusSafetyMap(); setGaugesVisible(!gaugesVisible) }}
              className={`text-cyan-adsb hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${gaugesVisible ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle stream gauges layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">waves</span>
              <span>{streamGauges}</span>
            </button>

            <button
              type="button"
              onClick={() => { focusSafetyMap(); setLightningVisible(!lightningVisible) }}
              className={`text-amber-gold hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${lightningVisible ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle lightning layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">electric_bolt</span>
              <span>{lightningCount}</span>
            </button>

            {/* Only shown when a source produces this entity type. */}

            {satellites > 0 && (
              <button
                type="button"
                onClick={() => toggleEntityType('satellite')}
                className={`text-violet-space hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${entityFilter.satellite ? 'opacity-100' : 'opacity-40'}`}
                title="Toggle satellites layer"
              >
                <span className="ms text-[12px]" aria-hidden="true">satellite_alt</span>
                <span>{satellites}</span>
              </button>

            )}

            <button
              type="button"
              onClick={() => { focusSafetyMap(); setCamerasVisible(!camerasVisible) }}
              className={`text-amber-gold hover:text-white transition-all flex items-center gap-1 focus:outline-hidden ${camerasVisible ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle traffic cameras layer"
            >
              <span className="ms text-[12px]" aria-hidden="true">videocam</span>
              <span>{cams}</span>
            </button>
          </div>

          <div className="mt-auto mb-1">
            <span
              className={`w-2.5 h-2.5 rounded-full block ${connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency'}`}
              title={connected ? 'WebSocket connected' : 'Disconnected'}
            />
          </div>
        </div>
      ) : (
      <>

      {/* Grid status */}
      <div className="p-4 border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span className="label-caps">GRID STATUS</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`ms text-[14px] ${health.ok ? 'text-amber-gold' : 'text-red-emergency'}`}
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              monitor_heart
            </span>
            <span
              className={`ml-1 w-2 h-2 rounded-full ${connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency shadow-[0_0_8px_rgba(255,59,48,0.5)]'}`}
              title={connected ? 'WebSocket connected' : 'Disconnected'}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <GridStatusDots ok={health.ok} />
            <div className="flex flex-col">
              <span className={`font-mono text-[12px] uppercase tracking-tighter ${health.ok ? 'text-amber-gold' : 'text-red-emergency font-bold'}`}>
                {health.ok ? 'Nominal' : 'Degraded'}
              </span>
              {!health.ok && (
                <span className="text-[11px] text-red-emergency/80 uppercase font-mono tracking-tight">
                  Check service logs
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <span className={`flex items-center text-[11px] font-mono ${activeInc > 0 ? `${incColor} ${advisoryLevel === 'red' ? 'animate-pulse' : ''}` : 'text-on-surface-variant opacity-20'}`} title="Advisories">
               <span className="ms text-[14px] mr-1" aria-hidden="true">warning</span>
               ADV {activeInc}
             </span>
             <span className={`flex items-center text-[11px] font-mono ${wAlerts > 0 ? 'text-amber-gold' : 'text-on-surface-variant opacity-20'}`} title="Weather Alerts">
               <span className="ms text-[14px] mr-1" aria-hidden="true">cloud_alert</span>
               {wAlerts}
             </span>
          </div>
        </div>

        {/* Map layers: entity counts that toggle their layer (collapsible) */}
        <button
          type="button"
          onClick={() => setLayersOpen((o) => !o)}
          aria-expanded={layersOpen}
          aria-controls="sidebar-layers"
          className="w-full flex items-center justify-between border-t border-white/5 pt-3 label-caps hover:text-on-surface"
        >
          Map layers
          <span className="ms text-[16px] leading-none" aria-hidden="true">{layersOpen ? 'expand_less' : 'expand_more'}</span>
        </button>
        {layersOpen && (
        <div id="sidebar-layers" className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px] font-mono pt-3">
          <button
            type="button"
            onClick={() => toggleEntityType('aircraft_group')}
            className={`text-cyan-adsb hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.aircraft ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle aircraft layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">flight</span>
            Aircraft: {aircraft}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('vessel')}
            className={`text-green-ais hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.vessel ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle vessels layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">sailing</span>
            Vessels: {vessels}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('train')}
            className={`text-amber-gold hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.train ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle trains layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">directions_railway</span>
            Trains: {trains}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('bus')}
              className={`text-transit-bus hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.bus ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle buses layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">directions_bus</span>
            Buses: {buses}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('aprs')}
            className={`text-violet-space hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.aprs ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle APRS layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">sensors</span>
            APRS: {aprs}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('fire_incident')}
            className={`text-red-emergency hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.fire_incident ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle hazards layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">local_fire_department</span>
            Hazards: {fire}
          </button>
          <button
            type="button"
            onClick={() => toggleEntityType('mesh_node')}
            className={`text-lime-rf hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.mesh_node ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle mesh nodes layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">hub</span>
            Mesh Nodes: {meshNodes}
          </button>
          {/* Only shown when a source produces this entity type. */}
          {rfSensors > 0 && (
            <button
              type="button"
              onClick={() => toggleEntityType('rf_sensor')}
              className={`text-lime-rf hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.rf_sensor ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle RF sensors layer"
            >
              <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">sensors</span>
              RF Sensors: {rfSensors}
            </button>
          )}
          <button
            type="button"
            onClick={() => { focusSafetyMap(); setGaugesVisible(!gaugesVisible) }}
            className={`text-cyan-adsb hover:text-white transition-all flex items-center text-left focus:outline-hidden ${gaugesVisible ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle stream gauges layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">waves</span>
            Gauges: {streamGauges}
          </button>
          <button
            type="button"
            onClick={() => { focusSafetyMap(); setLightningVisible(!lightningVisible) }}
            className={`text-amber-gold hover:text-white transition-all flex items-center text-left focus:outline-hidden ${lightningVisible ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle lightning layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">electric_bolt</span>
            Lightning: {lightningCount}
          </button>
          <button
            type="button"
            onClick={() => { focusSafetyMap(); setDispatchVisible(!dispatchVisible) }}
            className={`text-amber-p25 hover:text-white transition-all flex items-center text-left focus:outline-hidden ${dispatchVisible ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle dispatch incidents layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">cell_tower</span>
            Dispatch: {dispatchCount}
          </button>
          {/* Only shown when a source produces this entity type. */}
          {satellites > 0 && (
            <button
              type="button"
              onClick={() => toggleEntityType('satellite')}
              className={`text-violet-space hover:text-white transition-all flex items-center text-left focus:outline-hidden ${entityFilter.satellite ? 'opacity-100' : 'opacity-40'}`}
              title="Toggle satellites layer"
            >
              <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">satellite_alt</span>
              Satellites: {satellites}
            </button>
          )}
          <button
            type="button"
            onClick={() => { focusSafetyMap(); setCamerasVisible(!camerasVisible) }}
            className={`text-amber-gold hover:text-white transition-all flex items-center text-left col-span-2 focus:outline-hidden mt-0.5 ${camerasVisible ? 'opacity-100' : 'opacity-40'}`}
            title="Toggle traffic cameras layer"
          >
            <span className="ms text-[14px] mr-1.5 shrink-0" aria-hidden="true">videocam</span>
            Traffic Cameras: {cams}
          </button>
        </div>
        )}
      </div>


      {/* Scrollable content: what matters now */}
      <div className="flex-1 overflow-y-auto p-4">
        <SituationRail />
      </div>
      </>
      )}
    </aside>
  )
}
