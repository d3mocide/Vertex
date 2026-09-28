import type { WeatherAlert } from '../../../store'

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
        </div>
        {isSevere && (
          <span className="ms text-red-500 animate-pulse text-[20px]" aria-hidden="true">warning</span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4">
        <div className="flex flex-col">
          <span className="text-[11px] font-mono text-on-surface-variant uppercase tracking-widest">Expires</span>
          <span className="text-[11px] font-mono text-on-surface uppercase font-bold">{new Date(alert.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {isSevere && (
        <div className="absolute inset-0 bg-red-600/5 pointer-events-none" />
      )}
    </div>
  )
}
