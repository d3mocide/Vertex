import { useEffect, useState } from 'react'
import { useCivicStore, ALT_RANGE_DEFAULT, SPD_RANGE_DEFAULT } from '../../store'
import { isMajorTrafficIncident } from '../../incidentUtils'

const INCIDENTS_COLLAPSE_KEY = 'vertex.sidebar.incidentsCollapsed'
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

function IncidentCard({
  id,
  time,
  title,
  location,
  summary,
  link,
  severity,
}: {
  id: string
  time: string
  title: string
  location?: string
  summary?: string
  link?: string
  severity: 'high' | 'low'
}) {
  const [expanded, setExpanded] = useState(false)
  const isHigh = severity === 'high'
  return (
    <div
      className="incident-card cursor-pointer"
      role="listitem"
      tabIndex={0}
      aria-label={`Incident ${id}: ${title}`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span
            className="ms text-[14px] leading-none"
            aria-hidden="true"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            {isHigh ? 'warning' : 'info'}
          </span>
          <span className={`font-mono text-[11px] ${isHigh ? 'text-amber-gold' : 'text-on-surface-variant'}`}>
            {id}
          </span>
        </div>
        <span className="font-mono text-[10px] text-on-surface-variant">{time}</span>
      </div>
      <p className="text-[12px] text-on-surface leading-tight">{title}</p>
      {location && (
        <p className="text-[10px] text-on-surface-variant mt-1 leading-tight">{location}</p>
      )}

      {expanded && summary && (
        <p className="text-[10px] text-on-surface-variant leading-relaxed mt-2 whitespace-pre-wrap break-words">
          {summary}
        </p>
      )}

      {expanded && link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex mt-2 font-mono text-[9px] uppercase tracking-widest text-amber-gold hover:text-white"
          onClick={(e) => e.stopPropagation()}
        >
          Open Incident Source
        </a>
      )}
    </div>
  )
}

function NewsRow({ source, age, title }: { source: string; age: string; title: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-0.5 bg-amber-gold shrink-0" aria-hidden="true" />
      <div>
        <span className="font-mono text-[9px] text-on-surface-variant block mb-1 uppercase tracking-tighter">
          {source} • {age}
        </span>
        <p className="text-[11px] text-on-surface hover:text-amber-gold cursor-pointer transition-colors leading-relaxed">
          {title}
        </p>
      </div>
    </div>
  )
}

export function Sidebar() {
  const {
    alerts,
    news,
    health,
    entities,
    connected,
    cameras,
    weather,
    trafficIncidents,
    lightningStrikes,
    setActiveTab,
    setEntityFilter,
    setEntitySearchQuery,
    setEntityAltRange,
    setEntitySpeedRange,
    setCamerasVisible,
    setGaugesVisible,
    setLightningVisible,
  } = useCivicStore()

  const entityList = Object.values(entities)
  const aircraft     = entityList.filter((e) => e.entity_type === 'aircraft').length
  const vessels      = entityList.filter((e) => e.entity_type === 'vessel').length
  const aprs         = entityList.filter((e) => e.entity_type === 'aprs').length
  const fire         = entityList.filter((e) => e.entity_type === 'fire_incident').length
  const meshNodes    = entityList.filter((e) => e.entity_type === 'mesh_node').length
  const streamGauges = entityList.filter((e) => e.entity_type === 'stream_gauge').length
  const satellites   = entityList.filter((e) => e.entity_type === 'satellite').length
  const tinygsStations = entityList.filter((e) => e.entity_type === 'tinygs_station').length
  const lightningCount = lightningStrikes.length
  const cams          = cameras.length
  const wAlerts       = weather.alerts.length
  // Filter for major/local traffic incidents only
  const significantIncidents = trafficIncidents.filter(isMajorTrafficIncident)

  // Use dedicated traffic incidents feed.
  // Expanded mode shows all significant incidents; compact mode shows top 3.
  const incidents = significantIncidents
  const compactIncidents = significantIncidents.slice(0, 3)
  const activeInc = significantIncidents.length

  const [incidentsCollapsedPref, setIncidentsCollapsedPref] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(INCIDENTS_COLLAPSE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
    return null
  })

  const incidentsCollapsed = incidentsCollapsedPref ?? activeInc >= 3
  const [compactExpandedIndex, setCompactExpandedIndex] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY)
    if (stored === null) return true
    return stored === '1'
  })

  useEffect(() => {
    if (incidentsCollapsedPref === null || typeof window === 'undefined') return
    window.localStorage.setItem(INCIDENTS_COLLAPSE_KEY, incidentsCollapsedPref ? '1' : '0')
  }, [incidentsCollapsedPref])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? '1' : '0')
  }, [sidebarCollapsed])

  // News items from store, fallback to empty
  // News items filtered for Regional News only
  const newsItems = news
    .filter(item => item.category === 'Regional News')
    .sort((a, b) => {
      const bTs = Date.parse(b.published || '') || 0
      const aTs = Date.parse(a.published || '') || 0
      return bTs - aTs
    })

  const focusSafetyMap = () => {
    setActiveTab('safety')
    setEntitySearchQuery('')
    setEntityAltRange(ALT_RANGE_DEFAULT)
    setEntitySpeedRange(SPD_RANGE_DEFAULT)
  }

  const focusEntityType = (target: {
    aircraft?: boolean
    adsbLocal?: boolean
    adsbSupplement?: boolean
    vessel?: boolean
    mesh_node?: boolean
    aprs?: boolean
    fire_incident?: boolean
    satellite?: boolean
    tinygs_station?: boolean
  }) => {
    focusSafetyMap()
    setEntityFilter({
      aircraft: false,
      adsbLocal: false,
      adsbSupplement: false,
      vessel: false,
      mesh_node: false,
      aprs: false,
      fire_incident: false,
      satellite: false,
      tinygs_station: false,
    })
    setEntityFilter(target)
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
          className="flex items-center gap-3 min-w-0 opacity-90 hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
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
              <span className="text-[16px] font-black tracking-[0.05em] text-white uppercase select-none leading-none">
                VERTEX
              </span>
              <span className="font-mono text-[9px] tracking-[0.2em] text-amber-gold uppercase leading-none">
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
            className="text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Overview"
            title="Overview"
          >
            <span className="ms text-[20px]" aria-hidden="true">dashboard</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('incidents')}
            className={`${activeInc > 0 ? 'text-red-emergency' : 'text-on-surface-variant'} hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Incidents ${activeInc}`}
            title={`Incidents: ${activeInc}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">warning</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('environment')}
            className={`${wAlerts > 0 ? 'text-amber-gold' : 'text-on-surface-variant'} hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Weather alerts ${wAlerts}`}
            title={`Weather alerts: ${wAlerts}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">cloud_alert</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('community')}
            className={`${alerts.length > 0 ? 'text-amber-gold' : 'text-on-surface-variant'} hover:text-amber-gold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold`}
            aria-label={`Community alerts ${alerts.length}`}
            title={`Community alerts: ${alerts.length}`}
          >
            <span className="ms text-[20px]" aria-hidden="true">groups</span>
          </button>

          <div className="mt-2 w-8 border-t border-white/10" aria-hidden="true" />

          <div className="flex flex-col items-center gap-1.5 text-[9px] font-mono text-on-surface-variant">
            <button type="button" onClick={() => focusEntityType({ aircraft: true, adsbLocal: true, adsbSupplement: true })} className="text-cyan-adsb hover:text-white transition-colors flex items-center gap-1" title="Show aircraft only"><span className="ms text-[12px]" aria-hidden="true">flight</span><span>{aircraft}</span></button>
            <button type="button" onClick={() => focusEntityType({ vessel: true })} className="text-green-ais hover:text-white transition-colors flex items-center gap-1" title="Show vessels only"><span className="ms text-[12px]" aria-hidden="true">directions_boat</span><span>{vessels}</span></button>
            <button type="button" onClick={() => focusEntityType({ aprs: true })} className="text-violet-space hover:text-white transition-colors flex items-center gap-1" title="Show APRS only"><span className="ms text-[12px]" aria-hidden="true">sensors</span><span>{aprs}</span></button>
            <button type="button" onClick={() => focusEntityType({ fire_incident: true })} className="text-red-emergency hover:text-white transition-colors flex items-center gap-1" title="Show fire incidents only"><span className="ms text-[12px]" aria-hidden="true">local_fire_department</span><span>{fire}</span></button>
            <button type="button" onClick={() => focusEntityType({ mesh_node: true })} className="text-amber-p25 hover:text-white transition-colors flex items-center gap-1" title="Show mesh nodes only"><span className="ms text-[12px]" aria-hidden="true">router</span><span>{meshNodes}</span></button>
            <button type="button" onClick={() => { focusSafetyMap(); setGaugesVisible(true) }} className="text-cyan-adsb hover:text-white transition-colors flex items-center gap-1" title="Focus stream gauges"><span className="ms text-[12px]" aria-hidden="true">water</span><span>{streamGauges}</span></button>
            <button type="button" onClick={() => { focusSafetyMap(); setLightningVisible(true) }} className="text-amber-gold hover:text-white transition-colors flex items-center gap-1" title="Focus lightning"><span className="ms text-[12px]" aria-hidden="true">electric_bolt</span><span>{lightningCount}</span></button>
            <button type="button" onClick={() => focusEntityType({ satellite: true })} className="text-violet-space hover:text-white transition-colors flex items-center gap-1" title="Show satellites only"><span className="ms text-[12px]" aria-hidden="true">satellite_alt</span><span>{satellites}</span></button>
            <button type="button" onClick={() => focusEntityType({ tinygs_station: true })} className="text-amber-p25 hover:text-white transition-colors flex items-center gap-1" title="Show TinyGS stations only"><span className="ms text-[12px]" aria-hidden="true">satellite</span><span>{tinygsStations}</span></button>
            <button type="button" onClick={() => { focusSafetyMap(); setCamerasVisible(true) }} className="text-amber-gold hover:text-white transition-colors flex items-center gap-1" title="Focus traffic cameras"><span className="ms text-[12px]" aria-hidden="true">videocam</span><span>{cams}</span></button>
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
                <span className="text-[9px] text-red-emergency/80 uppercase font-mono tracking-tight">
                  Check service logs
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
             <span className={`flex items-center text-[10px] font-mono ${activeInc > 0 ? 'text-red-emergency animate-pulse' : 'text-on-surface-variant opacity-20'}`} title="Active Incidents">
               <span className="ms text-[14px] mr-1" aria-hidden="true">warning</span>
               INC {activeInc}
             </span>
             <span className={`flex items-center text-[10px] font-mono ${wAlerts > 0 ? 'text-amber-gold' : 'text-on-surface-variant opacity-20'}`} title="Weather Alerts">
               <span className="ms text-[14px] mr-1" aria-hidden="true">cloud_alert</span>
               {wAlerts}
             </span>
          </div>
        </div>

        {/* Entity count strip */}
        <div className="flex flex-col gap-2.5 text-[10px] font-mono border-t border-white/5 pt-3">
          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              <span className="text-cyan-adsb flex items-center" title="Aircraft (ADS-B)">
                <span className="ms text-[14px] mr-1" aria-hidden="true">flight</span>
                {aircraft}
              </span>
              <span className="text-green-ais flex items-center" title="Vessels (AIS)">
                <span className="ms text-[14px] mr-1" aria-hidden="true">directions_boat</span>
                {vessels}
              </span>
            </div>
            <div className="flex gap-4">
              <span className="text-amber-gold flex items-center" title="Traffic Cameras">
                <span className="ms text-[14px] mr-1" aria-hidden="true">videocam</span>
                {cams}
              </span>
              <span className="text-amber-p25 flex items-center" title="Mesh Nodes">
                <span className="ms text-[14px] mr-1" aria-hidden="true">router</span>
                {meshNodes}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              <span className="text-violet-space flex items-center" title="APRS">
                <span className="ms text-[14px] mr-1" aria-hidden="true">sensors</span>
                {aprs}
              </span>
              <span className="text-red-emergency flex items-center" title="Fire incidents">
                <span className="ms text-[14px] mr-1" aria-hidden="true">local_fire_department</span>
                {fire}
              </span>
            </div>
            <div className="flex gap-4">
              <span className="text-cyan-adsb flex items-center" title="Stream gauges">
                <span className="ms text-[14px] mr-1" aria-hidden="true">water</span>
                {streamGauges}
              </span>
              <span className="text-amber-gold flex items-center" title="Lightning strikes">
                <span className="ms text-[14px] mr-1" aria-hidden="true">electric_bolt</span>
                {lightningCount}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-4">
              <span className="text-violet-space flex items-center" title="Satellites">
                <span className="ms text-[14px] mr-1" aria-hidden="true">satellite_alt</span>
                {satellites}
              </span>
              <span className="text-amber-p25 flex items-center" title="TinyGS stations">
                <span className="ms text-[14px] mr-1" aria-hidden="true">satellite</span>
                {tinygsStations}
              </span>
            </div>
          </div>
        </div>
      </div>


      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Active incidents */}
        <section aria-labelledby="incidents-heading">
          <div className="mb-3 flex items-center gap-2">
            <button
              id="incidents-heading"
              className="section-heading !mb-0 flex-1 cursor-pointer hover:text-amber-gold"
              aria-expanded={!incidentsCollapsed}
              aria-controls="sidebar-incidents-list"
              onClick={() => {
                setIncidentsCollapsedPref((v) => {
                  const current = v ?? activeInc >= 3
                  return !current
                })
              }}
              title={incidentsCollapsed ? 'Expand incidents' : 'Collapse incidents'}
            >
              <span className="w-1 h-1 bg-amber-gold shrink-0" aria-hidden="true" />
              Active Incidents
              <span className="ms text-[14px] ml-auto text-on-surface-variant" aria-hidden="true">
                {incidentsCollapsed ? 'expand_more' : 'expand_less'}
              </span>
            </button>

            {incidents.length > 0 && (
              <span className="font-mono text-[9px] bg-amber-gold text-onyx-black px-1.5 py-0.5 font-bold">
                {incidents.length}
              </span>
            )}
          </div>

          {activeInc > (incidentsCollapsed ? compactIncidents.length : incidents.length) && (
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] text-on-surface-variant">
                Showing {incidentsCollapsed ? compactIncidents.length : incidents.length} of {activeInc} incidents
              </span>
              <button
                onClick={() => setActiveTab('incidents')}
                className="font-mono text-[9px] uppercase tracking-widest text-amber-gold hover:text-white"
              >
                View All
              </button>
            </div>
          )}

          {incidents.length === 0 ? (
            <p className="text-[10px] text-on-surface-variant/60 italic text-center py-2">No active incidents</p>
          ) : incidentsCollapsed ? (
            <div id="sidebar-incidents-list" className="space-y-2" role="list">
              {compactIncidents.map((incident, i) => (
                <div className="incident-card" role="listitem" key={`compact-${i}`}>
                  <button
                    type="button"
                    className="w-full text-left"
                    aria-expanded={compactExpandedIndex === i}
                    onClick={() => setCompactExpandedIndex((prev) => (prev === i ? null : i))}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <p className="text-[12px] text-on-surface leading-tight line-clamp-1">
                        {deriveIncidentTitle(incident)}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="font-mono text-[10px] text-on-surface-variant">
                          {formatIncidentTime(incident.pubDate ?? '')}
                        </span>
                        <span className="ms text-[13px] text-on-surface-variant" aria-hidden="true">
                          {compactExpandedIndex === i ? 'expand_less' : 'expand_more'}
                        </span>
                      </div>
                    </div>
                  </button>
                  {formatIncidentLocation(incident) && (
                    <p className="text-[10px] text-on-surface-variant mt-1 leading-tight line-clamp-1">
                      {formatIncidentLocation(incident)}
                    </p>
                  )}
                  {compactExpandedIndex === i && incident.description && (
                    <p className="text-[10px] text-on-surface-variant leading-relaxed mt-2 whitespace-pre-wrap break-words">
                      {incident.description}
                    </p>
                  )}
                  {compactExpandedIndex === i && incident.link && /^https?:\/\//i.test(incident.link) && (
                    <a
                      href={incident.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex mt-2 font-mono text-[9px] uppercase tracking-widest text-amber-gold hover:text-white"
                    >
                      Open Incident Source
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div id="sidebar-incidents-list" className="space-y-3" role="list">
              {incidents.map((incident, i) => (
                <IncidentCard
                  key={i}
                  id={`INC-${String(i + 1).padStart(4, '0')}`}
                  time={formatIncidentTime(incident.pubDate ?? '')}
                  title={deriveIncidentTitle(incident)}
                  location={formatIncidentLocation(incident)}
                  summary={incident.description}
                  link={incident.link}
                  severity={/high|major|severe|critical|closure|crash/i.test(incident.severity ?? '') ? 'high' : 'low'}
                />
              ))}
            </div>
          )}
        </section>

        {/* News feed */}
        <section className="pt-4 border-t border-amber-gold-muted/30" aria-labelledby="news-heading">
          <h3 id="news-heading" className="section-heading">
            <span className="w-1 h-1 bg-on-surface-variant shrink-0" aria-hidden="true" />
            News Feed
          </h3>

          {newsItems.length === 0 ? (
            <p className="text-[10px] text-on-surface-variant/60 italic text-center py-2">No feed data yet</p>
          ) : (
            <div className="space-y-4">
              {newsItems.map((item, i) => (
                <NewsRow
                  key={i}
                  source={item.source.toUpperCase()}
                  age={formatAge(item.published)}
                  title={item.title}
                />
              ))}
            </div>
          )}
        </section>
      </div>
      </>
      )}
    </aside>
  )
}

function formatAge(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatIncidentTime(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return '—'
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

function formatIncidentLocation(incident: {
  location?: string
  lat?: number
  lon?: number
}): string | undefined {
  const location = incident.location?.trim()
  if (location) return location

  if (typeof incident.lat === 'number' && typeof incident.lon === 'number') {
    return `${incident.lat.toFixed(4)}, ${incident.lon.toFixed(4)}`
  }

  return undefined
}

function deriveIncidentTitle(incident: {
  title?: string
  description?: string
  location?: string
  lat?: number
  lon?: number
}): string {
  const title = (incident.title ?? '').trim()
  const generic = /^traffic\s+incident$/i.test(title)
  if (title && !generic) return title

  const location = formatIncidentLocation(incident)
  if (location) return `Incident near ${location}`

  const description = (incident.description ?? '').trim()
  if (description) return description

  return 'Traffic incident'
}
