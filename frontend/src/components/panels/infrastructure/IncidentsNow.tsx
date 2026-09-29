import { useState } from 'react'
import type { TrafficCamera, TrafficIncident } from '../../../storeTypes'
import { classifyIncident, formatIncidentAge, incidentAgeDays, nearestCamera } from '../../../incidentUtils'

const SHOWN = 6

function place(inc: TrafficIncident): string {
  return (inc.location ?? '').trim() || (inc.lat != null && inc.lon != null ? `${inc.lat.toFixed(3)}, ${inc.lon.toFixed(3)}` : '')
}

// "Traffic Impacts: no impacts" style titles carry no news; prefer the first sentence of the description.
function headline(inc: TrafficIncident): string {
  const title = (inc.title ?? '').trim()
  if (title && !/^traffic (incident|impacts)/i.test(title)) return title
  const first = (inc.description ?? '').split(/(?<=[.!?])\s/)[0]?.trim()
  return first || title || 'Traffic incident'
}

/** Closures and delays near us — nearest camera alongside so you can look at the road. */
export function IncidentsNow({ incidents, cameras, onOpenCamera }: {
  incidents: TrafficIncident[]
  cameras: TrafficCamera[]
  onOpenCamera: (id: string) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? incidents : incidents.slice(0, SHOWN)
  const closures = incidents.filter((i) => classifyIncident(i) === 'closure').length

  return (
    <section aria-labelledby="now-heading">
      <div className="flex items-center justify-between mb-3">
        <h3 id="now-heading" className="section-heading">
          <span className="ms text-[16px] leading-none text-amber-gold" aria-hidden="true">report</span>
          On the road now
        </h3>
        <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
          {incidents.length === 0 ? 'nothing near you' : `${closures} closure${closures === 1 ? '' : 's'} · ${incidents.length - closures} delay${incidents.length - closures === 1 ? '' : 's'}`}
        </span>
      </div>

      {incidents.length === 0 ? (
        <div className="hud-panel px-4 py-3 flex items-center gap-3">
          <span className="ms text-[18px] leading-none text-green-ais" aria-hidden="true">check_circle</span>
          <span className="text-[12px] text-on-surface">No closures or delays reported near you.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((inc, idx) => {
            const cls = classifyIncident(inc)
            const cam = nearestCamera(cameras, inc.lat, inc.lon)
            const age = formatIncidentAge(incidentAgeDays(inc))
            const closure = cls === 'closure'
            return (
              <article
                key={`${inc.title}-${idx}`}
                className={`flex gap-3 border p-3 relative ${closure ? 'border-amber-gold/50 bg-amber-gold/10' : 'border-white/10 bg-onyx-deep/40'}`}
              >
                {closure && <div className="absolute top-0 left-0 w-1 h-full bg-amber-gold" aria-hidden="true" />}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${closure ? 'border-amber-gold text-amber-gold' : 'border-white/20 text-on-surface-variant'}`}>
                      {closure ? 'Closure' : 'Delay'}
                    </span>
                    {inc.dist_km != null && <span className="font-mono text-[11px] text-on-surface-variant">{Math.round(inc.dist_km)} km</span>}
                    {age && <span className="font-mono text-[11px] text-on-surface-variant">· {age}</span>}
                  </div>
                  <p className={`text-[13px] font-bold leading-tight ${closure ? 'text-amber-gold' : 'text-on-surface'}`}>{headline(inc)}</p>
                  {place(inc) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant font-mono">
                      <span className="ms text-[13px]" aria-hidden="true">location_on</span>
                      <span className="truncate">{place(inc)}</span>
                    </div>
                  )}
                  {inc.description && <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-2">{inc.description}</p>}
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
          })}
          {incidents.length > SHOWN && (
            <button type="button" onClick={() => setAll((v) => !v)} className="font-mono text-[11px] uppercase tracking-widest text-amber-gold hover:text-white">
              {all ? 'Show fewer' : `Show all ${incidents.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
