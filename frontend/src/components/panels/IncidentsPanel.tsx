import { useEffect, useState } from 'react'
import { WeatherAlert, SystemEvent, SummaryPosture, useCivicPick } from '../../store'
import { isMajorTrafficIncident, isIncidentInRadius } from '../../incidentUtils'
import ReactMarkdown, { type Components } from 'react-markdown'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { RadioIncidents, isActive } from './RadioIncidents'
import { EmsActivity } from './EmsActivity'
import { PageHeader, StatTiles, type Stat } from '../common/Page'
import { SituationRail } from '../layout/SituationRail'

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

function postureClass(posture: SummaryPosture): string {
  if (posture === 'HIGH') return 'border-red-emergency bg-red-emergency/10 text-red-emergency'
  if (posture === 'ELEVATED') return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-green-ais bg-green-ais/10 text-green-ais'
}

/** Split the briefing markdown into its intro (bottom line) and `##` sections. */
function splitBriefing(md: string): { intro: string; sections: { title: string; body: string }[] } {
  const parts = md.split(/^#{2,3}\s+/m)
  const intro = parts[0].trim()
  const sections = parts.slice(1).map((chunk) => {
    const nl = chunk.indexOf('\n')
    return nl < 0
      ? { title: chunk.trim(), body: '' }
      : { title: chunk.slice(0, nl).trim(), body: chunk.slice(nl + 1).trim() }
  })
  return { intro, sections }
}

const BRIEFING_MD = {
  strong: ({ ...props }) => <strong className="text-amber-gold font-bold" {...props} />,
  ul: ({ ...props }) => <ul className="list-disc list-outside ml-4 my-1.5 stack-y-1.5" {...props} />,
  li: ({ ...props }) => <li className="pl-1" {...props} />,
  p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
} satisfies Components

/**
 * AI briefing, compact by default: posture, the bottom line and what changed
 * since the last briefing. The remaining sections open on demand, so the
 * incident list isn't pushed several screens down.
 */
function BriefingCard() {
  const { summary } = useCivicPick('summary')
  const [expanded, setExpanded] = useState(false)
  if (!summary.summary) return null

  const { intro, sections } = splitBriefing(summary.summary)
  const changesIdx = sections.findIndex((sec) => /change/i.test(sec.title))
  const lead = changesIdx >= 0 ? [sections[changesIdx]] : []
  const rest = sections.filter((_, i) => i !== changesIdx)

  const renderSection = (sec: { title: string; body: string }) => (
    <div key={sec.title} className="mt-4">
      <h4 className="section-heading mb-1.5">{sec.title}</h4>
      <ReactMarkdown components={BRIEFING_MD}>{sec.body}</ReactMarkdown>
    </div>
  )

  return (
    <section className="border border-amber-gold/40 bg-amber-gold/6 p-4" aria-labelledby="briefing-heading">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="ms text-[18px] text-amber-gold" aria-hidden="true">psychology</span>
        <h3 id="briefing-heading" className="section-heading mb-0!">AI Briefing</h3>
        {summary.posture && (
          <span className={`border px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest ${postureClass(summary.posture)}`}>
            {summary.posture}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">
          {summary.windowHours ? `last ${summary.windowHours}h · ` : ''}
          {summary.ts ? new Date(summary.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </span>
      </div>

      <div className="text-[14px] lg:text-[13px] text-on-surface leading-relaxed mt-3">
        {intro && <ReactMarkdown components={BRIEFING_MD}>{intro}</ReactMarkdown>}
        {lead.map(renderSection)}
        {expanded && rest.map(renderSection)}
        {expanded && summary.dataGaps.length > 0 && (
          <div className="mt-4">
            <h4 className="section-heading mb-1.5">Data gaps</h4>
            <ul className="list-disc list-outside ml-4 stack-y-1 text-on-surface-variant">
              {summary.dataGaps.map((gap) => <li key={gap} className="pl-1">{gap}</li>)}
            </ul>
          </div>
        )}
      </div>

      {(rest.length > 0 || summary.dataGaps.length > 0) && (
        <div className="mt-3 pt-3 border-t border-amber-gold/15 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex items-center gap-1 h-8 whitespace-nowrap font-bold text-[11px] uppercase tracking-widest text-amber-gold hover:text-white focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
          >
            <span className="ms text-[18px] leading-none" aria-hidden="true">{expanded ? 'expand_less' : 'expand_more'}</span>
            {expanded ? 'Show less' : `Full briefing · ${rest.length + (summary.dataGaps.length ? 1 : 0)} more sections`}
          </button>
          {expanded && summary.model && (
            <span className="hidden lg:inline ml-auto font-mono text-[11px] text-amber-gold/40 truncate">{summary.model}</span>
          )}
        </div>
      )}
    </section>
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
  const { weather, trafficIncidents, systemEvents, radioIncidents } = useCivicPick('weather', 'trafficIncidents', 'systemEvents', 'radioIncidents')
  const [showMinor, setShowMinor] = useState(false)

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

  const now = Date.now()
  const dispatch = (radioIncidents?.incidents ?? []).filter((i) => i.severity >= 3)
  const dispatchActive = dispatch.filter((i) => isActive(i, now)).length
  const jump = (id: string) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const tiles: Stat[] = [
    { label: 'Dispatch active', value: dispatchActive, tone: dispatchActive ? 'warn' : 'muted',
      hint: `${dispatch.length} significant · 24h`, onClick: jump('sec-dispatch') },
    { label: 'NWS alerts', value: weatherAlerts.length, tone: weatherAlerts.length ? 'alert' : 'muted',
      hint: weatherAlerts[0]?.event ?? 'None active', onClick: weatherAlerts.length ? jump('sec-weather') : undefined },
    { label: 'Major traffic', value: significantTraffic.length, tone: significantTraffic.length ? 'warn' : 'muted',
      hint: `${lowImpactTraffic.length} minor nearby`, onClick: significantTraffic.length ? jump('sec-traffic') : undefined },
    { label: 'Priority events', value: prioritySystemEvents.length, tone: prioritySystemEvents.length ? 'alert' : 'muted',
      hint: 'High / critical system', onClick: prioritySystemEvents.length ? jump('sec-events') : undefined },
  ]

  return (
    <div>
      <PageHeader
        icon="report"
        title="Incidents"
        subtitle="Dispatch, weather, traffic and system alerts"
      />
      <div className="p-4 lg:p-6 stack-y-6">

      {/* Phones have no sidebar: its "Now" and "Nearby" blocks lead here. */}
      <div className="lg:hidden border border-white/10 bg-surface-container/40 p-3">
        <SituationRail parts={['now', 'nearby']} />
      </div>

      <StatTiles items={tiles} />

      <BriefingCard />

      {/* 1. WEATHER ADVISORIES */}
      {weatherAlerts.length > 0 && (
        <div id="sec-weather" className="stack-y-4 scroll-mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">cloud_alert</span>
            <h3 className="section-heading mb-0!">Weather Advisories</h3>
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

      {/* 2. DISPATCH INCIDENTS — clustered from P25 radio (list + map) */}
      <div id="sec-dispatch" className="scroll-mt-4"><RadioIncidents /></div>

      <EmsActivity />

      {/* 3. PRIORITY SYSTEM EVENTS */}
      {prioritySystemEvents.length > 0 && (
        <div id="sec-events" className="stack-y-4 scroll-mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-red-emergency" aria-hidden="true">emergency_home</span>
            <h3 className="section-heading mb-0!">Priority System Events</h3>
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

      {/* 4. SIGNIFICANT TRAFFIC INCIDENTS */}
      {significantTraffic.length > 0 && (
        <div id="sec-traffic" className="stack-y-4 scroll-mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">traffic</span>
            <h3 className="section-heading mb-0!">Significant Traffic Incidents</h3>
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

      {/* 5. MINOR NEARBY TRAFFIC — collapsed by default */}
      {lowImpactTraffic.length > 0 && (
        <div className="pt-4 border-t border-white/5">
          <button
            type="button"
            onClick={() => setShowMinor((v) => !v)}
            aria-expanded={showMinor}
            className="flex items-center gap-2 h-9 text-on-surface-variant hover:text-on-surface focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
          >
            <span className="ms text-[18px]" aria-hidden="true">{showMinor ? 'expand_less' : 'expand_more'}</span>
            <span className="label-caps text-current!">Minor traffic within 8 km · {lowImpactTraffic.length}</span>
          </button>
          {showMinor && <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
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
          </div>}
        </div>
      )}

      </div>
    </div>
  )
}
