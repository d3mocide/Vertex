import { useState } from 'react'
import type { TrafficCamera, TrafficIncident } from '../../../storeTypes'
import { formatIncidentAge, incidentSinceDays, nearestCamera, type IncidentGroup } from '../../../incidentUtils'

const SHOWN = 5

function place(inc: TrafficIncident): string {
  return (inc.location ?? '').trim() || (inc.lat != null && inc.lon != null ? `${inc.lat.toFixed(3)}, ${inc.lon.toFixed(3)}` : '')
}

// "Traffic Impacts: no impacts" style titles carry no news; prefer the first sentence of the description.
function headline(inc: TrafficIncident): string {
  const title = (inc.title ?? '').trim()
  if (title && !/^traffic (incident|impacts)/i.test(title)) return title
  const first = (inc.description ?? '').split(/(?<=[.!?])\s/)[0]?.trim()
  return first || title.replace(/^traffic impacts:\s*/i, '') || 'Traffic incident'
}

// ODOT's "first reported" is when the project record was made — years ago for long jobs — so it only
// says something for recent events. The headline carries the dates for planned closures.
const RECENT_DAYS = 30
const reportedLabel = (inc: TrafficIncident) => {
  const days = incidentSinceDays(inc)
  return days != null && days <= RECENT_DAYS ? `reported ${formatIncidentAge(days)}` : ''
}

function badge(g: IncidentGroup): { text: string; cls: string } {
  if (g.unplanned) return { text: 'Incident', cls: 'border-amber-p25 text-amber-p25' }
  if (g.kind === 'closure' && g.scope === 'road') return { text: 'Road closed', cls: 'border-amber-gold text-amber-gold' }
  if (g.kind === 'closure') return { text: g.members.length ? 'Ramps closed' : 'Closure', cls: 'border-amber-gold/60 text-amber-gold' }
  return { text: 'Delay', cls: 'border-white/20 text-on-surface-variant' }
}

function GroupCard({ g, cameras, onOpenCamera }: { g: IncidentGroup; cameras: TrafficCamera[]; onOpenCamera: (id: string) => void }) {
  const inc = g.lead
  const cam = nearestCamera(cameras, inc.lat, inc.lon)
  const b = badge(g)
  const since = reportedLabel(inc)
  const hot = g.highlight
  return (
    <article className={`flex gap-3 border p-3 relative ${hot ? 'border-amber-gold/50 bg-amber-gold/10' : 'border-white/10 bg-onyx-deep/40'}`}>
      {hot && <div className="absolute top-0 left-0 w-1 h-full bg-amber-gold" aria-hidden="true" />}
      <div className="flex-1 min-w-0 stack-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${b.cls}`}>{b.text}</span>
          {inc.dist_km != null && <span className="font-mono text-[11px] text-on-surface-variant">{Math.round(inc.dist_km)} km</span>}
          {since && <span className="font-mono text-[11px] text-on-surface-variant">· {since}</span>}
        </div>
        <p className={`text-[13px] font-bold leading-tight ${hot ? 'text-amber-gold' : 'text-on-surface'}`}>{headline(inc)}</p>
        {place(inc) && (
          <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant font-mono">
            <span className="ms text-[13px]" aria-hidden="true">location_on</span>
            <span className="truncate">{place(inc)}</span>
          </div>
        )}
        {inc.description && <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-2">{inc.description}</p>}
        {g.members.length > 0 && (
          <details className="group/d mt-1">
            <summary className="cursor-pointer list-none flex items-center gap-1 text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
              <span className="ms text-[14px] group-open/d:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
              Also closed here · {g.members.length}
            </summary>
            <ul className="mt-1 stack-y-1">
              {g.members.map((m, i) => (
                <li key={`${m.title}-${i}`} className="font-mono text-[11px] text-on-surface-variant leading-snug border-l border-amber-gold/40 pl-2">
                  {headline(m)}
                </li>
              ))}
            </ul>
          </details>
        )}
        {inc.link && (
          <a href={inc.link} target="_blank" rel="noreferrer noopener" className="inline-block font-mono text-[11px] uppercase tracking-widest text-amber-gold hover:text-white">Source</a>
        )}
      </div>
      {cam && (
        <button
          type="button"
          onClick={() => onOpenCamera(cam.id)}
          className="shrink-0 w-24 self-start relative border border-white/10 hover:border-amber-gold/60 transition-colors"
          aria-label={`Open camera ${cam.name}`}
          title={cam.name}
        >
          {cam.url ? <img src={cam.url} alt="" className="w-24 h-16 object-cover" loading="lazy" /> : <div className="w-24 h-16 bg-surface-container" />}
          <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/70 font-mono text-[10px] text-on-surface truncate">{cam.name}</span>
        </button>
      )}
    </article>
  )
}

/**
 * What matters on the road now. Crashes and hazards, roads that are actually shut and anything new
 * come first; ongoing ramp closures — often a dozen for one project — fold into one line each.
 */
export function IncidentsNow({ groups, cameras, onOpenCamera }: {
  groups: IncidentGroup[]
  cameras: TrafficCamera[]
  onOpenCamera: (id: string) => void
}) {
  const [all, setAll] = useState(false)
  const top = groups.filter((g) => g.highlight)
  const delays = groups.filter((g) => !g.highlight && g.kind === 'delay')
  const ongoing = groups.filter((g) => !g.highlight && g.kind === 'closure')
  const visibleTop = all ? [...top, ...delays] : [...top, ...delays].slice(0, SHOWN)
  const hiddenCount = top.length + delays.length - visibleTop.length

  const events = groups.filter((g) => g.unplanned).length
  const closed = groups.filter((g) => g.kind === 'closure' && !g.unplanned).length
  const summary = groups.length === 0 ? 'nothing near you'
    : [events ? `${events} incident${events === 1 ? '' : 's'}` : '', closed ? `${closed} closure${closed === 1 ? '' : 's'}` : '',
       delays.length ? `${delays.length} delay${delays.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')

  return (
    <section aria-labelledby="now-heading">
      <div className="flex items-center justify-between mb-3">
        <h3 id="now-heading" className="section-heading">
          <span className="ms text-[16px] leading-none text-amber-gold" aria-hidden="true">report</span>
          On the road now
        </h3>
        <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">{summary}</span>
      </div>

      {groups.length === 0 ? (
        <div className="hud-panel px-4 py-3 flex items-center gap-3">
          <span className="ms text-[18px] leading-none text-green-ais" aria-hidden="true">check_circle</span>
          <span className="text-[12px] text-on-surface">No closures or delays reported near you.</span>
        </div>
      ) : (
        <div className="stack-y-2">
          {visibleTop.map((g) => <GroupCard key={g.key} g={g} cameras={cameras} onOpenCamera={onOpenCamera} />)}
          {hiddenCount > 0 && (
            <button type="button" onClick={() => setAll(true)} className="font-mono text-[11px] uppercase tracking-widest text-amber-gold hover:text-white">
              Show {hiddenCount} more
            </button>
          )}

          {ongoing.length > 0 && (
            <details className="group border border-white/10 bg-onyx-deep/30">
              <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-[12px] uppercase tracking-widest text-on-surface-variant hover:text-on-surface">
                <span className="ms text-[16px] group-open:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
                Ongoing closures
                <span className="font-mono text-amber-gold">{ongoing.reduce((n, g) => n + 1 + g.members.length, 0)}</span>
                <span className="font-mono text-[11px] normal-case tracking-normal">· ramps and lanes, days to weeks old</span>
              </summary>
              <div className="px-3 pb-3 stack-y-2">
                {ongoing.map((g) => <GroupCard key={g.key} g={g} cameras={cameras} onOpenCamera={onOpenCamera} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
