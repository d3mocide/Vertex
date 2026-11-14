import type { WeatherAlert } from '../../../store'

const leadText = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)

export function WeatherAlertCard({ alert }: { alert: WeatherAlert }) {
  const isSevere = /warning|emergency|critical/i.test(alert.event)

  const showEvent = !alert.headline.toLowerCase().includes(alert.event.toLowerCase())
  const expires = alert.expires
    ? new Date(alert.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const radio = alert.source === 'nwr' || alert.rf_heard

  return (
    <div className={`hud-panel px-3 py-2 bg-onyx-deep/60 relative overflow-hidden border-l-2 ${isSevere ? 'border-l-red-600' : 'border-l-amber-gold'}`}>
      <div className="flex items-center gap-2 min-w-0">
        {isSevere && (
          <span className="ms text-red-500 animate-pulse text-[16px] leading-none" aria-hidden="true">warning</span>
        )}
        <span className="flex-1 min-w-0 truncate text-[13px] font-bold text-on-surface" title={alert.headline}>
          {showEvent && (
            <span className={`mr-2 text-[11px] font-black uppercase tracking-widest ${isSevere ? 'text-red-500' : 'text-amber-gold'}`}>{alert.event}</span>
          )}
          {alert.headline}
        </span>
        {radio && (
          <span className="status-pill shrink-0 border border-amber-gold/50 text-amber-gold"
                title={alert.nwr_state_label || 'Also announced on NOAA Weather Radio'}>
            {alert.source === 'nwr' ? 'NWR · RF' : 'RF HEARD'}
          </span>
        )}
        {expires && (
          <span className="shrink-0 font-mono text-[11px] text-on-surface-variant" title="Expires">
            EXP <span className="text-on-surface font-bold">{expires}</span>
          </span>
        )}
      </div>

      {alert.area_desc && (
        <p className="mt-1 truncate text-[11px] text-on-surface-variant" title={alert.area_desc}>{alert.area_desc}</p>
      )}

      {(alert.nwr_lead_s != null || alert.nwr_cap_first) && (
        <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
          {alert.nwr_cap_first
            ? 'The NWS feed already had this when the radio announced it'
            : alert.nwr_lead_s! >= 5
              ? `Heard on the radio ${leadText(alert.nwr_lead_s!)} before the NWS feed showed it`
              : 'Radio and NWS feed showed it together'}
        </p>
      )}

      {isSevere && (
        <div className="absolute inset-0 bg-red-600/5 pointer-events-none" />
      )}
    </div>
  )
}
