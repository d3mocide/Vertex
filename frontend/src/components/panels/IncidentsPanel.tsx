import { useEffect } from 'react'
import { useCivicStore, WeatherAlert, SystemEvent } from '../../store'
import { isMajorTrafficIncident, isIncidentInRadius } from '../../incidentUtils'
import ReactMarkdown from 'react-markdown'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

function formatIncidentLocation(incident: { location?: string; lat?: number; lon?: number }): string | undefined {
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

function AiTrafficSummary() {
  const { summary } = useCivicStore()
  if (!summary.summary) return null

  return (
    <div className="border border-amber-gold/40 bg-amber-gold/10 p-4 mb-8 relative overflow-hidden group">
      {/* Decorative scanner line */}
      <div className="absolute top-0 left-0 w-full h-[1px] bg-amber-gold/30 animate-scan z-0" />
      
      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <span className="ms text-[18px] text-amber-gold animate-pulse" aria-hidden="true">
            psychology
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-gold">
            AI Situational Briefing
          </h3>
        </div>
        <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">
          {summary.ts
            ? new Date(summary.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'No timestamp'}
        </span>
      </div>

      <div className="text-[12px] text-on-surface leading-relaxed relative z-10 font-sans">
        <ReactMarkdown
          components={{
            strong: ({ ...props }) => <strong className="text-amber-gold font-bold" {...props} />,
            ul: ({ ...props }) => <ul className="list-disc list-outside ml-4 my-2 space-y-1" {...props} />,
            li: ({ ...props }) => <li className="pl-1" {...props} />,
            p: ({ ...props }) => <p className="mb-3 last:mb-0" {...props} />,
          }}
        >
          {summary.summary}
        </ReactMarkdown>
      </div>

      {summary.model && (
        <div className="mt-3 pt-2 border-t border-amber-gold/10 flex justify-end relative z-10">
          <span className="text-[11px] font-mono text-amber-gold/40 uppercase">
            Analytic Engine: {summary.model}
          </span>
        </div>
      )}
    </div>
  )
}

function severityColorClass(severity: string) {
  const s = severity.toLowerCase()
  if (s.includes('extreme') || s.includes('severe')) return 'border-red-emergency bg-red-emergency/10 text-red-emergency'
  if (s.includes('moderate')) return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-on-surface-variant/40 bg-on-surface-variant/5 text-on-surface-variant'
}

function sysSeverityColorClass(severity: string) {
  const s = severity.toLowerCase()
  if (s === 'high' || s === 'critical') return 'border-red-emergency bg-red-emergency/10 text-red-emergency'
  if (s === 'med' || s === 'warning') return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-on-surface-variant/40 bg-on-surface-variant/5 text-on-surface-variant'
}

export function IncidentsPanel() {
  const { weather, trafficIncidents, systemEvents } = useCivicStore()

  // Request an on-demand AI summary refresh whenever this panel is opened.
  // The updated result arrives via the existing WebSocket → store flow.
  useEffect(() => {
    fetch(`${API_BASE}/summary/refresh`, {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => { /* best-effort */ })
  }, [])

  const weatherAlerts = weather.alerts || []
  const significantTraffic = trafficIncidents.filter(isMajorTrafficIncident)
  const lowImpactTraffic = trafficIncidents.filter(inc => {
    // Only show low-impact if within 8km (roughly 5 miles)
    return !isMajorTrafficIncident(inc) && isIncidentInRadius(inc, 8)
  })
  
  // Filter for high priority system events
  const prioritySystemEvents = (systemEvents || []).filter(ev => 
    ev.severity?.toLowerCase() === 'high' || ev.severity?.toLowerCase() === 'critical'
  )

  const totalAlerts = weatherAlerts.length + significantTraffic.length + prioritySystemEvents.length

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-24 space-y-8">
      
      {/* AI SUMMARY AT TOP */}
      <AiTrafficSummary />

      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter text-on-surface">
            Operational Threats
          </h2>
          <p className="text-xs text-on-surface-variant font-mono uppercase tracking-widest mt-1">
            {totalAlerts} critical / high-value alert{totalAlerts !== 1 ? 's' : ''} active across all domains
          </p>
        </div>
      </header>

      {/* 1. WEATHER ADVISORIES */}
      {weatherAlerts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">cloud_alert</span>
            <h3 className="section-heading !mb-0">Weather Advisories</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {weatherAlerts.map((alert, idx) => {
              const colorClass = severityColorClass(alert.severity)
              return (
                <article key={`wx-${idx}`} className={`border p-4 ${colorClass}`}>
                  <h4 className="text-sm font-bold uppercase mb-1">{alert.event}</h4>
                  <p className="text-xs font-mono mb-2 opacity-80">{alert.headline}</p>
                  <p className="text-[11px] leading-relaxed line-clamp-3 hover:line-clamp-none cursor-help transition-all">
                    {alert.description}
                  </p>
                  <div className="mt-3 pt-2 border-t border-current/10 flex justify-between items-center text-[11px] font-mono uppercase">
                    <span>Severity: {alert.severity}</span>
                    <span>Expires: {new Date(alert.expires).toLocaleTimeString()}</span>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. PRIORITY SYSTEM EVENTS */}
      {prioritySystemEvents.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-red-emergency" aria-hidden="true">emergency_home</span>
            <h3 className="section-heading !mb-0">Priority System Events</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prioritySystemEvents.map((ev, idx) => {
              const colorClass = sysSeverityColorClass(ev.severity)
              return (
                <article key={`sys-${idx}`} className={`border p-3 flex flex-col gap-2 ${colorClass}`}>
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-mono px-1.5 py-0.5 bg-current/10 uppercase tracking-widest">
                      {ev.event_type}
                    </span>
                    <span className="text-[11px] font-mono opacity-60">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-[12px] font-bold leading-tight">{ev.summary}</p>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. SIGNIFICANT TRAFFIC INCIDENTS */}
      {significantTraffic.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">traffic</span>
            <h3 className="section-heading !mb-0">Significant Traffic Incidents</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {significantTraffic.map((incident, idx) => (
              <article key={`sig-${idx}`} className="border border-amber-gold/40 bg-amber-gold/5 p-4 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-gold" aria-hidden="true" />
                
                <div className="flex justify-between items-start gap-4">
                  <p className="text-[13px] font-bold text-amber-gold leading-tight">
                    {deriveIncidentTitle(incident)}
                  </p>
                  <span className="font-mono text-[11px] text-on-surface-variant shrink-0 bg-onyx-black/60 px-1.5 py-0.5 rounded-sm">
                    {incident.pubDate ? new Date(incident.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                  </span>
                </div>

                {formatIncidentLocation(incident) && (
                  <div className="flex items-center gap-1 text-[11px] text-on-surface-variant font-mono">
                    <span className="ms text-[14px]" aria-hidden="true">location_on</span>
                    {formatIncidentLocation(incident)}
                  </div>
                )}

                {incident.description && (
                  <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-3">
                    {incident.description}
                  </p>
                )}

                <div className="mt-auto pt-3 flex items-center justify-between border-t border-white/5">
                  <span className="bg-amber-gold/20 text-amber-gold text-[11px] font-bold px-1.5 py-0.5 uppercase tracking-tighter rounded-sm">
                    High Priority
                  </span>
                  {incident.link && /^https?:\/\//i.test(incident.link) && (
                    <a
                      href={incident.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] uppercase tracking-widest text-amber-gold hover:text-white"
                    >
                      Report Source
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* 4. MUTED / LOW IMPACT INCIDENTS */}
      {lowImpactTraffic.length > 0 && (
        <div className="pt-8 border-t border-white/5">
          <div className="flex items-center gap-2 mb-4 opacity-40">
            <span className="ms text-[16px] text-on-surface-variant" aria-hidden="true">minor_crash</span>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">Filtered Minor Incidents</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {lowImpactTraffic.map((incident, idx) => (
              <article key={`low-${idx}`} className="border border-white/5 bg-onyx-deep/50 p-3 flex flex-col gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-[12px] font-bold text-on-surface leading-tight">
                    {deriveIncidentTitle(incident)}
                  </p>
                  <span className="font-mono text-[11px] text-on-surface-variant shrink-0">
                    {incident.pubDate ? new Date(incident.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                  </span>
                </div>
                
                {incident.description && (
                  <p className="text-[11px] text-on-surface-variant leading-snug line-clamp-2">
                    {incident.description}
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
