import { useEffect, useState } from 'react'
import { useCivicStore, SystemEvent } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders, clearToken } from '../../auth'
import { FireStatusCard, firePanelEntityFromEntity, type FirePanelEntity, type FireRelevance } from './environment/FireStatusCard'
import { SeismicCard } from './environment/SeismicCard'
import { AqiGauge } from './environment/AqiGauge'
import { WeatherAlertCard } from './environment/WeatherAlertCard'
import { WeatherCard } from './environment/WeatherCard'
import { RadarControls } from './environment/RadarMiniMap'
import { PirepCard } from './environment/PirepCard'
import { MetarCard } from './environment/MetarCard'

export function EnvironmentPanel() {
  const weather = useCivicStore((s) => s.weather)
  const setRadarVisible = useCivicStore((s) => s.setRadarVisible)
  const liveSystemEvents = useCivicStore((s) => s.systemEvents)
  const entities = useCivicStore((s) => s.entities)
  const [seismicEvents, setSeismicEvents] = useState<SystemEvent[]>([])

  const fireEntities = Object.values(entities)
    .map(firePanelEntityFromEntity)
    .filter((fire): fire is FirePanelEntity => fire !== null)
    .sort((a, b) => {
      const rank = (value: FireRelevance) => value === 'local' ? 0 : 1
      const distanceA = a.distanceKm ?? Number.POSITIVE_INFINITY
      const distanceB = b.distanceKm ?? Number.POSITIVE_INFINITY
      return rank(a.relevance) - rank(b.relevance) || distanceA - distanceB
    })
  const localFires = fireEntities.filter((fire) => fire.relevance === 'local')
  const regionalFires = fireEntities.filter((fire) => fire.relevance === 'regional')

  const mergedSeismicEvents = Array.from(
    new Map(
      [...seismicEvents, ...liveSystemEvents.filter((ev) => ev.event_type === 'seismic')].map((ev) => [ev.event_id, ev]),
    ).values(),
  ).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))


  useEffect(() => {
    let cancelled = false

    const loadSeismic = async () => {
      try {
        const res = await fetch(`${API_BASE}/events?hours=24`, { headers: authHeaders() })
        if (res.status === 401) { clearToken(); window.location.reload(); return }
        if (!res.ok) return
        const data = await res.json() as SystemEvent[]
        if (cancelled || !Array.isArray(data)) return
        setSeismicEvents(data.filter((ev) => ev.event_type === 'seismic'))
      } catch {
        // Keep last known list when request fails.
      }
    }

    loadSeismic()
    const timer = setInterval(loadSeismic, 60000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  return (
    <div className="flex flex-col h-full z-10">
      {/* Header Info Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Region Center</span>
            <span className="text-[10px] font-mono text-on-surface font-bold uppercase tracking-widest">Tualatin, OR · 45.38°N 122.76°W</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Last Update</span>
            <span className="text-[10px] font-mono text-on-surface font-bold uppercase tracking-widest">DATA LIVE</span>
          </div>
        </div>

        <div className="flex items-center gap-4 font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500/40" /> NWS</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" /> EPA</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/40" /> LOCAL SENSORS</span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 p-2 sm:p-4 lg:p-6 items-stretch lg:items-start">

          {/* LEFT COLUMN: Data Stream */}
          <div className="flex-1 min-w-0 flex flex-col gap-8 lg:pr-1">
            {/* NWS Alerts */}
            <section aria-labelledby="nws-heading">
              {weather.alerts.length === 0 ? (
                <div className="hud-panel p-8 flex flex-col items-center justify-center gap-4 bg-onyx-deep/40 border-dashed border-white/5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-green-ais/20 blur-xl rounded-full animate-pulse" />
                    <span className="ms text-[48px] text-green-ais relative" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <p className="font-mono text-[12px] text-on-surface font-bold uppercase tracking-[0.2em]">Systems Nominal</p>
                    <p className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">No active weather advisories for this region</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {weather.alerts.map((alert, i) => (
                    <WeatherAlertCard key={i} alert={alert} />
                  ))}
                </div>
              )}

              {/* Hazard quick cards */}
              <div className="mt-6">
                <div className="label-caps text-[10px] text-on-surface-variant mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-white/5" />
                  HAZARD STATUS INDICATORS
                  <span className="h-px flex-1 bg-white/5" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: 'ac_unit',   label: 'Freeze',  active: weather.alerts.some((a) => /freeze|frost/i.test(a.event)) },
                    { icon: 'water',     label: 'Flood',   active: weather.alerts.some((a) => /flood|surge/i.test(a.event))  },
                    { icon: 'tornado',   label: 'Wind',    active: weather.alerts.some((a) => /wind|gust/i.test(a.event))   },
                  ].map((h) => (
                    <div
                      key={h.label}
                      className={`relative p-4 border rounded-sm flex flex-col items-center gap-2 text-center transition-all duration-500 ${h.active ? 'border-amber-gold/30 bg-amber-gold/5 shadow-[0_0_15px_rgba(255,184,0,0.1)]' : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}
                      role="status"
                      aria-label={`${h.label} hazard: ${h.active ? 'active' : 'none'}`}
                    >
                      {h.active && (
                        <div className="absolute top-1 right-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-gold animate-ping" />
                        </div>
                      )}
                      <span
                        className={`ms text-[24px] leading-none transition-colors ${h.active ? 'text-amber-gold' : 'text-on-surface-variant opacity-40'}`}
                        aria-hidden="true"
                        style={{ fontVariationSettings: `'FILL' ${h.active ? 1 : 0}` }}
                      >
                        {h.icon}
                      </span>
                      <div className="flex flex-col">
                        <span className={`text-[10px] font-black uppercase tracking-tight ${h.active ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>{h.label}</span>
                        <span className={`font-mono text-[8px] font-bold mt-0.5 tracking-widest ${h.active ? 'text-amber-gold' : 'text-on-surface-variant/30'}`}>{h.active ? 'WATCH ACTIVE' : 'SECURE'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <AqiGauge aqi={weather.aqi} />

            <FireStatusCard
              localFires={localFires}
              regionalFires={regionalFires}
              aqi={weather.aqi}
              aqiLabel={weather.aqi_label}
            />
          </div>

          {/* RIGHT COLUMN: Radar + Aviation */}
          <div className="flex-1 min-w-0 flex flex-col self-stretch lg:self-start gap-6">
            <RadarControls />
            <WeatherCard />
            <SeismicCard events={mergedSeismicEvents} />
            <PirepCard />
            <MetarCard />
          </div>

        </div>
      </div>
    </div>
  )
}
