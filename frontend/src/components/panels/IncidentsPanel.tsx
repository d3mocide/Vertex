import { useCivicStore, WeatherAlert, SystemEvent } from '../../store'

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

function isSignificant(incident: { title?: string; description?: string }): boolean {
  const text = ((incident.title || '') + ' ' + (incident.description || '')).toLowerCase()
  return !text.includes('no impacts') && !text.includes('no traffic impacts')
}

// Map NWS severity to color classes
function severityColorClass(severity: string) {
  const s = severity.toLowerCase()
  if (s.includes('warning') || s.includes('extreme') || s.includes('severe')) {
    return 'border-red-emergency bg-red-emergency/10 text-red-emergency'
  }
  return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
}

// Map SystemEvent severity
function sysSeverityColorClass(severity: string) {
  const s = severity.toLowerCase()
  if (s === 'critical') return 'border-red-emergency/60 bg-red-emergency/5 text-red-emergency'
  if (s === 'high') return 'border-red-emergency/30 bg-red-emergency/5 text-red-emergency'
  return 'border-amber-gold/40 bg-amber-gold/5 text-amber-gold'
}

export function IncidentsPanel() {
  const { trafficIncidents, weather, systemEvents } = useCivicStore()

  const significantTraffic = trafficIncidents.filter(isSignificant)
  const lowImpactTraffic = trafficIncidents.filter(inc => !isSignificant(inc))
  
  // Filter for high priority system events
  const criticalSysEvents = systemEvents.filter(e => e.severity === 'critical' || e.severity === 'high')

  const totalAlerts = (weather.alerts?.length || 0) + criticalSysEvents.length + significantTraffic.length

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-24 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-amber-gold-muted/30 pb-4">
        <span className="ms text-[24px] text-amber-gold leading-none" aria-hidden="true">admin_panel_settings</span>
        <div className="flex-1">
          <h2 className="font-bold text-[14px] tracking-[0.2em] uppercase text-amber-gold">Unified Threat Board</h2>
          <p className="text-[10px] text-on-surface-variant mt-0.5">
            {totalAlerts} critical / high-value alert{totalAlerts !== 1 ? 's' : ''} active across all domains
          </p>
        </div>
      </div>

      {totalAlerts === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-on-surface-variant bg-onyx-deep border border-white/5">
          <span className="ms text-[48px] leading-none mb-3 text-green-ais/60">verified_user</span>
          <p className="text-[14px] uppercase tracking-[0.2em] font-bold text-green-ais/80">All Clear</p>
          <p className="text-[11px] uppercase tracking-widest mt-1">No active threats or significant incidents</p>
        </div>
      )}

      {/* 1. WEATHER ALERTS */}
      {weather.alerts && weather.alerts.length > 0 && (
        <section aria-labelledby="weather-threats-heading">
          <h3 id="weather-threats-heading" className="section-heading mb-4">
            <span className="ms text-[16px] leading-none text-amber-gold" aria-hidden="true">cloud_alert</span>
            Active Weather Threats ({weather.alerts.length})
          </h3>
          <div className="grid grid-cols-1 gap-3">
            {weather.alerts.map((alert, idx) => {
              const colorClass = severityColorClass(alert.severity)
              return (
                <article key={`wx-${idx}`} className={`border p-4 ${colorClass}`}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <p className="text-[14px] font-bold uppercase tracking-tight leading-snug">
                      {alert.event}
                    </p>
                    <span className="font-mono text-[10px] uppercase tracking-widest border px-1.5 py-0.5 shrink-0 bg-onyx-black/50">
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-[12px] font-semibold leading-snug mb-2">
                    {alert.headline}
                  </p>
                  <p className="text-[11px] leading-relaxed whitespace-pre-wrap opacity-90 line-clamp-4 hover:line-clamp-none transition-all">
                    {alert.description}
                  </p>
                  <div className="mt-3 pt-3 border-t border-current/20 flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-widest">
                      Expires: {new Date(alert.expires).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* 2. CRITICAL SYSTEM EVENTS */}
      {criticalSysEvents.length > 0 && (
        <section aria-labelledby="sys-events-heading">
          <h3 id="sys-events-heading" className="section-heading mb-4">
            <span className="ms text-[16px] leading-none text-red-emergency" aria-hidden="true">dns</span>
            Critical System Events ({criticalSysEvents.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {criticalSysEvents.map((ev, idx) => {
              const colorClass = sysSeverityColorClass(ev.severity)
              return (
                <article key={`sys-${idx}`} className={`border p-3 flex flex-col gap-2 ${colorClass}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-[10px] tracking-[0.1em] uppercase border border-current px-1.5 py-0.5 bg-onyx-black/30">
                      {ev.event_type.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-[9px] tracking-widest opacity-80 shrink-0">
                      {new Date(ev.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  {ev.entity_id && (
                    <p className="font-mono text-[10px] uppercase tracking-widest mt-1 opacity-75">
                      Entity: {ev.entity_id}
                    </p>
                  )}
                  <p className="text-[12px] font-semibold leading-snug">
                    {ev.summary}
                  </p>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* 3. TRAFFIC INCIDENTS */}
      {significantTraffic.length > 0 && (
        <section aria-labelledby="traffic-heading">
          <h3 id="traffic-heading" className="section-heading mb-4">
            <span className="ms text-[16px] leading-none text-amber-gold" aria-hidden="true">traffic</span>
            Significant Traffic Incidents ({significantTraffic.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {significantTraffic.map((incident, idx) => (
              <article key={`sig-${idx}`} className="border border-amber-gold/40 bg-amber-gold/5 p-4 flex flex-col gap-2 relative overflow-hidden group">
                <div className="absolute top-0 left-0 w-1 h-full bg-amber-gold" aria-hidden="true" />
                
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[13px] text-on-surface font-bold leading-snug">
                    {deriveIncidentTitle(incident)}
                  </p>
                  <span className="font-mono text-[10px] text-amber-gold shrink-0 border border-amber-gold/30 px-1.5 py-0.5 bg-onyx-black/50">
                    {incident.pubDate ? new Date(incident.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                  </span>
                </div>
                
                {formatIncidentLocation(incident) && (
                  <p className="text-[11px] text-amber-gold/80 leading-snug font-mono">
                    <span className="ms text-[12px] align-text-bottom mr-1" aria-hidden="true">location_on</span>
                    {formatIncidentLocation(incident)}
                  </p>
                )}
                
                {incident.description && (
                  <p className="text-[12px] text-on-surface-variant leading-relaxed whitespace-pre-wrap break-words mt-1">
                    {incident.description}
                  </p>
                )}
                
                {incident.link && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <a
                      href={incident.link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex font-mono text-[10px] uppercase tracking-widest text-amber-gold hover:text-white transition-colors"
                    >
                      <span className="ms text-[14px] align-text-bottom mr-1" aria-hidden="true">open_in_new</span>
                      Source
                    </a>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 4. MUTED / LOW IMPACT INCIDENTS */}
      {lowImpactTraffic.length > 0 && (
        <div className="mt-12 pt-6 border-t border-white/10">
          <h3 className="text-[11px] font-bold tracking-[0.2em] uppercase text-on-surface-variant mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-on-surface-variant/30" />
            Low Impact Traffic Incidents ({lowImpactTraffic.length})
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {lowImpactTraffic.map((incident, idx) => (
              <article key={`low-${idx}`} className="border border-white/5 bg-onyx-deep/50 p-3 flex flex-col gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] text-on-surface font-semibold leading-snug line-clamp-2">
                    {deriveIncidentTitle(incident)}
                  </p>
                  <span className="font-mono text-[9px] text-on-surface-variant shrink-0">
                    {incident.pubDate ? new Date(incident.pubDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                  </span>
                </div>
                
                {incident.description && (
                  <p className="text-[10px] text-on-surface-variant leading-snug line-clamp-2">
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
