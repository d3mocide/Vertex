import type { WeatherAlert } from '../../../store'

const leadText = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)

export function WeatherAlertCard({ alert }: { alert: WeatherAlert }) {
  const isSevere = /warning|emergency|critical/i.test(alert.event)

  return (
    <div className={`hud-panel p-4 bg-onyx-deep/60 relative overflow-hidden transition-all duration-500 ${isSevere ? 'border-l-2 border-l-red-600' : 'border-l-2 border-l-amber-gold'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col">
          <span className={`text-[11px] font-black uppercase tracking-widest ${isSevere ? 'text-red-500' : 'text-amber-gold'}`}>
            {alert.event}
          </span>
          <span className="text-[14px] font-bold text-on-surface leading-tight mt-1">
            {alert.headline}
          </span>
          {alert.area_desc && (
            <span className="text-[11px] text-on-surface-variant mt-1">{alert.area_desc}</span>
          )}
          {(alert.source === 'nwr' || alert.rf_heard) && (
            <span className="status-pill mt-1.5 self-start border border-amber-gold/50 text-amber-gold"
                  title={alert.nwr_state_label || 'Also announced on NOAA Weather Radio'}>
              {alert.source === 'nwr' ? 'NWR · RF' : 'RF HEARD'}
            </span>
          )}
        </div>
        {isSevere && (
          <span className="ms text-red-500 animate-pulse text-[20px]" aria-hidden="true">warning</span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <div className="flex flex-col">
          <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Expires</span>
          <span className="text-[11px] font-mono text-on-surface uppercase font-bold">{alert.expires ? new Date(alert.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
        </div>
      </div>

      {(alert.nwr_lead_s != null || alert.nwr_cap_first) && (
        <p className="mt-3 font-mono text-[11px] text-on-surface-variant">
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
