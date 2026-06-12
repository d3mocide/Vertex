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
import { GdacsCard } from './environment/GdacsCard'
import { NwwsCard } from './environment/NwwsCard'
import { PWSCard } from './environment/PWSCard'

export function EnvironmentPanel() {
  const weather = useCivicStore((s) => s.weather)
  const setRadarVisible = useCivicStore((s) => s.setRadarVisible)
  const liveSystemEvents = useCivicStore((s) => s.systemEvents)
  const entities = useCivicStore((s) => s.entities)
  const [seismicEvents, setSeismicEvents] = useState<SystemEvent[]>([])
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1024)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

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

  const resolveHazardState = (regex: RegExp, excludeRegex?: RegExp) => {
    const alerts = weather.alerts.filter((a) => regex.test(a.event) && (!excludeRegex || !excludeRegex.test(a.event)))
    if (alerts.length === 0) {
      return {
        active: false,
        label: 'SECURE',
        color: 'text-on-surface-variant opacity-40',
        border: 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]',
        dot: ''
      }
    }
    const isWarning = alerts.some((a) => /warning/i.test(a.event))
    return {
      active: true,
      label: isWarning ? 'WARNING ACTIVE' : 'WATCH ACTIVE',
      color: isWarning ? 'text-red-emergency' : 'text-amber-gold',
      border: isWarning
        ? 'border-red-emergency/30 bg-red-emergency/5 shadow-[0_0_15px_rgba(239,68,68,0.15)]'
        : 'border-amber-gold/30 bg-amber-gold/5 shadow-[0_0_15px_rgba(255,184,0,0.1)]',
      dot: isWarning ? 'bg-red-emergency' : 'bg-amber-gold'
    }
  }

  return (
    <div className="flex flex-col h-full z-10">
      {/* Header Info Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 px-6 py-3 border-b border-white/5">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex flex-col min-w-0">
            <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.2em] whitespace-nowrap">Region Center</span>
            <span className="text-[10px] lg:text-[11px] font-mono text-on-surface font-bold uppercase tracking-widest">
              Tualatin, OR <span className="opacity-30">·</span> 45.38°N 122.76°W
            </span>
          </div>
          <div className="w-px h-6 bg-white/10 shrink-0" />
          <div className="flex flex-col shrink-0">
            <span className="text-[8px] lg:text-[11px] font-mono text-on-surface-variant uppercase tracking-[0.2em] whitespace-nowrap">Last Update</span>
            <span className="text-[10px] lg:text-[11px] font-mono text-on-surface font-bold uppercase tracking-widest whitespace-nowrap">DATA LIVE</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[9px] lg:text-[11px] text-on-surface-variant uppercase tracking-widest shrink-0">
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-green-500/40" /> NWS</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" /> EPA</span>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/40" /> LOCAL SENSORS</span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
        {isMobile ? (
          <div className="flex flex-col gap-8 p-2 sm:p-4">
            {/* 1. NWS Alerts */}
            {weather.alerts.length === 0 ? (
              <div className="hud-panel p-8 flex flex-col items-center justify-center gap-4 bg-onyx-deep/40 border-dashed border-white/5">
                <div className="relative">
                  <div className="absolute inset-0 bg-green-ais/20 blur-xl rounded-full animate-pulse" />
                  <span className="ms text-[48px] text-green-ais relative" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>verified_user</span>
                </div>
                <div className="flex flex-col items-center">
                  <p className="font-mono text-[12px] lg:text-[14px] text-on-surface font-bold uppercase tracking-[0.2em]">Systems Nominal</p>
                  <p className="font-mono text-[9px] lg:text-[11px] text-on-surface-variant uppercase tracking-widest mt-1">No active weather advisories for this region</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {weather.alerts.map((alert, i) => (
                  <WeatherAlertCard key={i} alert={alert} />
                ))}
              </div>
            )}

            {/* 2. Hazard quick cards */}
            <div>
              <div className="label-caps text-[10px] lg:text-[11px] text-on-surface-variant mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-white/5" />
                HAZARD STATUS INDICATORS
                <span className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: 'thermostat',            label: 'Heat',         state: resolveHazardState(/heat|warm/i) },
                  { icon: 'water',                 label: 'Flood',        state: resolveHazardState(/flood|surge/i) },
                  { icon: 'tornado',               label: 'Wind',         state: resolveHazardState(/wind|gust/i) },
                  { icon: 'local_fire_department', label: 'Fire',         state: resolveHazardState(/fire|red flag|smoke/i) },
                  { icon: 'ac_unit',               label: 'Freeze',       state: resolveHazardState(/freeze|frost|winter|blizzard|snow|ice/i) },
                  { icon: 'thunderstorm',          label: 'Severe Storm', state: resolveHazardState(/thunderstorm|tornado|hail|squall|severe/i) },
                ].map((h) => (
                  <div
                    key={h.label}
                    className={`relative p-4 border rounded-sm flex flex-col items-center gap-2 text-center transition-all duration-500 ${h.state.border}`}
                    role="status"
                    aria-label={`${h.label} hazard: ${h.state.active ? 'active' : 'none'}`}
                  >
                    {h.state.active && (
                      <div className="absolute top-1 right-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${h.state.dot} animate-ping`} />
                      </div>
                    )}
                    <span
                      className={`ms text-[24px] leading-none transition-colors ${h.state.active ? h.state.color : 'text-on-surface-variant opacity-40'}`}
                      aria-hidden="true"
                      style={{ fontVariationSettings: `'FILL' ${h.state.active ? 1 : 0}` }}
                    >
                      {h.icon}
                    </span>
                    <div className="flex flex-col">
                      <span className={`text-[10px] lg:text-[11px] font-black uppercase tracking-tight ${h.state.active ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>{h.label}</span>
                      <span className={`font-mono text-[8px] lg:text-[11px] font-bold mt-0.5 tracking-widest ${h.state.active ? h.state.color : 'text-on-surface-variant/30'}`}>{h.state.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. WeatherCard (Current Conditions) under Hazards */}
            <WeatherCard />

            {/* 4. AqiGauge (Air Quality) */}
            <AqiGauge aqi={weather.aqi} />

            {/* 5. RadarControls (Radar) under Air Quality */}
            <RadarControls />

            {/* 6. NwwsCard (NWS Text) under Radar */}
            <NwwsCard />

            {/* 7. FireStatusCard (Fire/Smoke) */}
            <FireStatusCard
              localFires={localFires}
              regionalFires={regionalFires}
              aqi={weather.aqi}
              aqiLabel={weather.aqi_label}
            />

            {/* 8. GdacsCard (GDACS) under Fire/Smoke */}
            <GdacsCard />

            {/* 9. SeismicCard */}
            <SeismicCard events={mergedSeismicEvents} />

            {/* 10. PWSCard */}
            <PWSCard />

            {/* 11. MetarCard */}
            <MetarCard />

            {/* 12. PirepCard */}
            <PirepCard />
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 p-2 sm:p-4 lg:p-6 items-stretch lg:items-start">

            {/* LEFT COLUMN */}
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
                      <p className="font-mono text-[12px] lg:text-[14px] text-on-surface font-bold uppercase tracking-[0.2em]">Systems Nominal</p>
                      <p className="font-mono text-[9px] lg:text-[11px] text-on-surface-variant uppercase tracking-widest mt-1">No active weather advisories for this region</p>
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
                  <div className="label-caps text-[10px] lg:text-[11px] text-on-surface-variant mb-3 flex items-center gap-2">
                    <span className="h-px flex-1 bg-white/5" />
                    HAZARD STATUS INDICATORS
                    <span className="h-px flex-1 bg-white/5" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { icon: 'thermostat',            label: 'Heat',         state: resolveHazardState(/heat|warm/i) },
                      { icon: 'water',                 label: 'Flood',        state: resolveHazardState(/flood|surge/i) },
                      { icon: 'tornado',               label: 'Wind',         state: resolveHazardState(/wind|gust/i) },
                      { icon: 'local_fire_department', label: 'Fire',         state: resolveHazardState(/fire|red flag|smoke/i) },
                      { icon: 'ac_unit',               label: 'Freeze',       state: resolveHazardState(/freeze|frost|winter|blizzard|snow|ice/i) },
                      { icon: 'thunderstorm',          label: 'Severe Storm', state: resolveHazardState(/thunderstorm|tornado|hail|squall|severe/i) },
                    ].map((h) => (
                      <div
                        key={h.label}
                        className={`relative p-4 border rounded-sm flex flex-col items-center gap-2 text-center transition-all duration-500 ${h.state.border}`}
                        role="status"
                        aria-label={`${h.label} hazard: ${h.state.active ? 'active' : 'none'}`}
                      >
                        {h.state.active && (
                          <div className="absolute top-1 right-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${h.state.dot} animate-ping`} />
                          </div>
                        )}
                        <span
                          className={`ms text-[24px] leading-none transition-colors ${h.state.active ? h.state.color : 'text-on-surface-variant opacity-40'}`}
                          aria-hidden="true"
                          style={{ fontVariationSettings: `'FILL' ${h.state.active ? 1 : 0}` }}
                        >
                          {h.icon}
                        </span>
                        <div className="flex flex-col">
                          <span className={`text-[10px] lg:text-[11px] font-black uppercase tracking-tight ${h.state.active ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>{h.label}</span>
                          <span className={`font-mono text-[8px] lg:text-[11px] font-bold mt-0.5 tracking-widest ${h.state.active ? h.state.color : 'text-on-surface-variant/30'}`}>{h.state.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <AqiGauge aqi={weather.aqi} />
              <NwwsCard />
              <GdacsCard />
              
              <FireStatusCard
                localFires={localFires}
                regionalFires={regionalFires}
                aqi={weather.aqi}
                aqiLabel={weather.aqi_label}
              />

              <SeismicCard events={mergedSeismicEvents} />
            </div>

            {/* RIGHT COLUMN */}
            <div className="flex-1 min-w-0 flex flex-col self-stretch lg:self-start gap-8">
              <RadarControls />
              
              <div className="flex flex-col gap-4">
                <WeatherCard />
                <PWSCard />
              </div>

              <MetarCard />
              <PirepCard />
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
