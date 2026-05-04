import { useState } from 'react'
import { useCivicStore } from '../../store'
import { isMajorTrafficIncident } from '../../incidentUtils'

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
  const { alerts, news, health, entities, connected, cameras, weather, trafficIncidents, setActiveTab } = useCivicStore()

  const aircraft  = Object.values(entities).filter((e) => e.entity_type === 'aircraft').length
  const vessels   = Object.values(entities).filter((e) => e.entity_type === 'vessel').length
  const meshNodes = Object.values(entities).filter((e) => e.entity_type === 'mesh_node').length
  const cams      = cameras.length
  const wAlerts   = weather.alerts.length
  // Filter for major/local traffic incidents only
  const significantIncidents = trafficIncidents.filter(isMajorTrafficIncident)

  // Use dedicated traffic incidents feed (first 4 significant)
  const incidents = significantIncidents.slice(0, 4)
  const activeInc = significantIncidents.length

  // News items from store, fallback to empty
  // News items filtered for Regional News only
  const newsItems = news
    .filter(item => item.category === 'Regional News')
    .sort((a, b) => {
      const bTs = Date.parse(b.published || '') || 0
      const aTs = Date.parse(a.published || '') || 0
      return bTs - aTs
    })

  return (
    <aside
      className="w-80 h-full sidebar-panel flex flex-col shrink-0 z-30"
      aria-label="Vertex sidebar"
    >
      {/* Brand header */}
      <div className="h-16 flex items-center px-5 border-b border-white/5 bg-onyx-deep/40 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
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

          <div className="flex flex-col leading-none gap-1">
            <span className="text-[16px] font-black tracking-[0.05em] text-white uppercase select-none leading-none">
              VERTEX
            </span>
            <span className="font-mono text-[9px] tracking-[0.2em] text-amber-gold uppercase leading-none">
              SITUATIONAL AWARENESS
            </span>
          </div>
        </div>
      </div>

      {/* Grid status */}
      <div className="p-4 border-b border-amber-gold-muted bg-onyx-deep/60 shrink-0">
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
              {meshNodes > 0 && (
                <span className="text-amber-p25 flex items-center" title="Mesh Nodes">
                  <span className="ms text-[14px] mr-1" aria-hidden="true">router</span>
                  {meshNodes}
                </span>
              )}
            </div>
                </div>
        </div>
      </div>


      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-onyx-black">

        {/* Active incidents */}
        <section aria-labelledby="incidents-heading">
          <h3 id="incidents-heading" className="section-heading">
            <span className="w-1 h-1 bg-amber-gold shrink-0" aria-hidden="true" />
            Active Incidents
            {incidents.length > 0 && (
              <span className="ml-auto font-mono text-[9px] bg-amber-gold text-onyx-black px-1.5 py-0.5 font-bold">
                {incidents.length}
              </span>
            )}
          </h3>

          {activeInc > incidents.length && (
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] text-on-surface-variant">
                Showing {incidents.length} of {activeInc} incidents
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
          ) : (
            <div className="space-y-3" role="list">
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
