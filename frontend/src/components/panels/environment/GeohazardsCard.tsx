import type { SystemEvent } from '../../../store'

interface GdacsDetails {
  event_type_code?: string
  alert_level?: string
  severity_value?: number
  severity_unit?: string
  dist_km?: number
}

const mag = (ev: SystemEvent) => (typeof ev.details?.magnitude === 'number' ? (ev.details.magnitude as number) : null)
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

const LEVEL_TONE: Record<string, string> = { Red: 'text-red-emergency', Orange: 'text-amber-p25', Green: 'text-green-ais' }
const KIND_ICON: Record<string, string> = { FL: 'water', WF: 'local_fire_department', VO: 'volcano', TS: 'tsunami' }

/**
 * Quakes and regional disaster alerts. When both are empty it is one line — an
 * empty card would say the same thing in a hundred pixels of height.
 */
export function GeohazardsCard({ quakes, disasters }: { quakes: SystemEvent[]; disasters: SystemEvent[] }) {
  const strongest = quakes.reduce<number | null>((m, ev) => {
    const v = mag(ev)
    return v == null ? m : m == null ? v : Math.max(m, v)
  }, null)

  if (quakes.length === 0 && disasters.length === 0) {
    return (
      <div className="hud-panel px-4 py-3 bg-onyx-deep/40 flex items-center gap-3">
        <span className="ms text-[16px] leading-none text-green-ais" aria-hidden="true">check_circle</span>
        <span className="label-caps">GEOHAZARDS</span>
        <span className="font-mono text-[11px] text-on-surface-variant flex-1 text-right sm:text-left">
          No quakes (24 h) · no disaster alerts (72 h)
        </span>
      </div>
    )
  }

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">earthquake</span>
        GEOHAZARDS
        {strongest != null && <span className="ml-auto font-mono text-[11px] text-on-surface-variant normal-case tracking-normal">strongest M{strongest.toFixed(1)}</span>}
      </div>

      <div className="stack-y-1.5">
        {quakes.slice(0, 4).map((ev) => {
          const m = mag(ev)
          const place = typeof ev.details?.place === 'string' ? ev.details.place : ev.summary
          const depth = typeof ev.details?.depth_km === 'number' ? (ev.details.depth_km as number) : null
          return (
            <div key={ev.event_id} className="border border-white/10 bg-white/2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-bold text-on-surface truncate">{place}</span>
                <span className="font-mono text-[12px] text-amber-gold shrink-0">{m != null ? `M${m.toFixed(1)}` : ev.severity.toUpperCase()}</span>
              </div>
              <div className="flex items-center justify-between mt-1 font-mono text-[11px] text-on-surface-variant">
                <span>{when(ev.ts)}</span>
                {depth != null && <span>↓ {depth.toFixed(0)} km</span>}
              </div>
            </div>
          )
        })}

        {disasters.slice(0, 4).map((ev) => {
          const d = (ev.details ?? {}) as GdacsDetails
          const tone = LEVEL_TONE[d.alert_level ?? ''] ?? 'text-on-surface-variant'
          return (
            <div key={ev.event_id} className="border border-white/10 bg-white/2 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`ms text-[14px] leading-none ${tone}`} aria-hidden="true">{KIND_ICON[d.event_type_code ?? ''] ?? 'warning'}</span>
                <span className="text-[12px] font-bold text-on-surface truncate flex-1">{ev.summary}</span>
                {d.alert_level && <span className={`font-mono text-[11px] uppercase ${tone}`}>{d.alert_level}</span>}
              </div>
              <div className="flex items-center justify-between mt-1 font-mono text-[11px] text-on-surface-variant">
                <span>{when(ev.ts)}</span>
                {d.dist_km != null && <span>{Math.round(d.dist_km)} km</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
