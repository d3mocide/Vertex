import type { SystemEvent } from '../../../store'

function magnitudeFromEvent(event: SystemEvent): number | null {
  const raw = event.details?.magnitude
  return typeof raw === 'number' ? raw : null
}

export function SeismicCard({ events }: { events: SystemEvent[] }) {
  const strongest = events.reduce<number | null>((acc, ev) => {
    const mag = magnitudeFromEvent(ev)
    if (mag == null) return acc
    if (acc == null) return mag
    return Math.max(acc, mag)
  }, null)

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">earthquake</span>
        SEISMIC FEED
      </div>

      <div className="flex items-end justify-between mb-3">
        <div className="flex flex-col">
          <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Last 24 Hours</span>
          <span className="text-[18px] font-black text-on-surface tracking-tight">{events.length} event{events.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Strongest</span>
          <span className="font-mono text-[14px] text-amber-gold font-bold">
            {strongest != null ? `M${strongest.toFixed(1)}` : 'N/A'}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
            No recorded earthquakes in range
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.slice(0, 4).map((ev) => {
            const mag = magnitudeFromEvent(ev)
            const place = typeof ev.details?.place === 'string' ? ev.details.place : ev.summary
            const depthKm = typeof ev.details?.depth_km === 'number' ? ev.details.depth_km as number : null
            return (
              <div key={ev.event_id} className="border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-bold text-on-surface truncate">{place}</span>
                  <span className="font-mono text-[11px] text-amber-gold shrink-0">{mag != null ? `M${mag.toFixed(1)}` : ev.severity.toUpperCase()}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
                    {new Date(ev.ts).toLocaleString()}
                  </div>
                  {depthKm != null && (
                    <div className="font-mono text-[11px] text-sky-400/70 shrink-0">
                      ↓ {depthKm.toFixed(0)} km
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
