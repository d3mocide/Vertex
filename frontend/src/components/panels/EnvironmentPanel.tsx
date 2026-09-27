import { useEffect, useState } from 'react'
import { useCivicStore, SystemEvent } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders, clearToken } from '../../auth'
import { FireStatusCard, firePanelEntityFromEntity, type FirePanelEntity, type FireRelevance } from './environment/FireStatusCard'
import { SeismicCard } from './environment/SeismicCard'
import { AqiGauge } from './environment/AqiGauge'
import { WeatherAlertCard } from './environment/WeatherAlertCard'
import { RadarControls } from './environment/RadarMiniMap'
import { PirepCard } from './environment/PirepCard'
import { MetarCard } from './environment/MetarCard'
import { GdacsCard } from './environment/GdacsCard'
import { NwwsCard } from './environment/NwwsCard'
import { PWSCard } from './environment/PWSCard'
import { FeedAge } from '../common/FeedAge'
import { PageHeader, StatTiles, type Stat } from '../common/Page'

export function EnvironmentPanel() {
  const weather = useCivicStore((s) => s.weather)
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

  const hazards = [
    { icon: 'thermostat',            label: 'Heat',   re: /heat|warm/i },
    { icon: 'water',                 label: 'Flood',  re: /flood|surge/i },
    { icon: 'tornado',               label: 'Wind',   re: /wind|gust/i },
    { icon: 'local_fire_department', label: 'Fire',   re: /fire|red flag|smoke/i },
    { icon: 'ac_unit',               label: 'Winter', re: /freeze|frost|winter|blizzard|snow|ice/i },
    { icon: 'thunderstorm',          label: 'Storm',  re: /thunderstorm|tornado|hail|squall|severe/i },
  ].map((h) => {
    const matching = weather.alerts.filter((a) => h.re.test(a.event))
    const level: 'none' | 'watch' | 'warning' = matching.length === 0 ? 'none'
      : matching.some((a) => /warning/i.test(a.event)) ? 'warning' : 'watch'
    return { ...h, level }
  })

  const aqi = weather.aqi
  const aqiTone = aqi == null ? 'muted' : aqi <= 50 ? 'good' : aqi <= 100 ? 'warn' : 'alert'
  const alertCount = weather.alerts.length
  const hasWarning = weather.alerts.some((a) => /warning/i.test(a.event))
  const tiles: Stat[] = [
    { label: 'Temperature', value: weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '—', hint: weather.condition ?? undefined },
    { label: 'Air quality', value: aqi ?? '—', tone: aqiTone, hint: weather.aqi_label ?? undefined },
    { label: 'Wind', value: weather.wind_mph != null ? `${Math.round(weather.wind_mph)} mph` : '—',
      hint: [weather.wind_dir, weather.humidity != null ? `${Math.round(weather.humidity)}% RH` : null].filter(Boolean).join(' · ') || undefined },
    { label: 'NWS alerts', value: alertCount, tone: alertCount ? (hasWarning ? 'alert' : 'warn') : 'good',
      hint: alertCount ? weather.alerts[0].event : 'None for this region' },
  ]

  // One line of hazard icons; only active hazards light up.
  const hazardStrip = (
    <div className="flex items-center gap-2 flex-wrap" role="list" aria-label="Hazard status">
      {hazards.map((h) => (
        <span
          key={h.label}
          role="listitem"
          aria-label={`${h.label}: ${h.level === 'none' ? 'no alerts' : h.level}`}
          className={`h-8 px-2.5 flex items-center gap-1.5 border text-[11px] font-bold uppercase tracking-widest ${
            h.level === 'warning' ? 'border-red-emergency/50 bg-red-emergency/10 text-red-emergency'
            : h.level === 'watch' ? 'border-amber-gold/50 bg-amber-gold/10 text-amber-gold'
            : 'border-white/5 text-on-surface-variant/50'}`}
        >
          <span className="ms text-[16px] leading-none" aria-hidden="true" style={{ fontVariationSettings: `'FILL' ${h.level === 'none' ? 0 : 1}` }}>{h.icon}</span>
          {h.label}
          {h.level !== 'none' && <span className="font-mono">{h.level}</span>}
        </span>
      ))}
    </div>
  )

  // The NWS tile already says "0 · none for this region" when quiet.
  // Desktop: the full hazard board (one row of six status tiles). Phones use
  // the strip above — the board took a whole screen there.
  const hazardBoard = (
    <div className="hidden lg:grid grid-cols-6 gap-3" role="list" aria-label="Hazard status board">
      {hazards.map((h) => {
        const active = h.level !== 'none'
        const warn = h.level === 'warning'
        const tone = warn ? 'text-red-emergency' : 'text-amber-gold'
        return (
          <div
            key={h.label}
            role="listitem"
            aria-label={`${h.label}: ${active ? h.level : 'no alerts'}`}
            className={`relative p-4 border flex flex-col items-center gap-2 text-center transition-all duration-500 ${
              warn ? 'border-red-emergency/30 bg-red-emergency/5 shadow-[0_0_15px_rgba(198,40,40,0.15)]'
              : active ? 'border-amber-gold/30 bg-amber-gold/5 shadow-[0_0_15px_rgba(255,184,0,0.1)]'
              : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}`}
          >
            {active && (
              <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-ping ${warn ? 'bg-red-emergency' : 'bg-amber-gold'}`} aria-hidden="true" />
            )}
            <span
              className={`ms text-[24px] leading-none ${active ? tone : 'text-on-surface-variant opacity-40'}`}
              aria-hidden="true"
              style={{ fontVariationSettings: `'FILL' ${active ? 1 : 0}` }}
            >
              {h.icon}
            </span>
            <span className={`text-[11px] font-black uppercase tracking-tight ${active ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>{h.label}</span>
            <span className={`font-mono text-[11px] font-bold tracking-widest ${active ? tone : 'text-on-surface-variant/40'}`}>
              {warn ? 'WARNING ACTIVE' : active ? 'WATCH ACTIVE' : 'SECURE'}
            </span>
          </div>
        )
      })}
    </div>
  )

  const alertsBlock = alertCount === 0 ? null : (
    <div className="space-y-3">
      {weather.alerts.map((alert, i) => <WeatherAlertCard key={i} alert={alert} />)}
    </div>
  )

  const fireCard = (
    <FireStatusCard localFires={localFires} regionalFires={regionalFires} aqi={weather.aqi} aqiLabel={weather.aqi_label} />
  )

  return (
    <div className="flex flex-col h-full z-10">
      <PageHeader
        icon="eco"
        title="Environment"
        subtitle={<span className="flex items-center gap-2">Tualatin, OR <FeedAge feedKey="weather:current" prefix="Updated" className="text-[11px]" /></span>}
      />

      <div className="flex-1 overflow-y-auto min-h-0 pb-6">
        <div className="p-4 lg:p-6 space-y-4">
          <StatTiles items={tiles} />
          <section aria-label="Weather advisories" className="space-y-3">
            {alertsBlock}
            <div className="lg:hidden">{hazardStrip}</div>
            {hazardBoard}
          </section>
        </div>

        {isMobile ? (
          <div className="flex flex-col gap-6 px-4 pb-4">
            <RadarControls />
            <NwwsCard />
            {fireCard}
            <AqiGauge aqi={weather.aqi} />
            <GdacsCard />
            <SeismicCard events={mergedSeismicEvents} />
            <PWSCard />
            <MetarCard />
            <PirepCard />
          </div>
        ) : (
          <div className="flex gap-8 px-6 pb-6 items-start">
            <div className="flex-1 min-w-0 flex flex-col gap-8">
              <NwwsCard />
              {fireCard}
              <AqiGauge aqi={weather.aqi} />
              <GdacsCard />
              <SeismicCard events={mergedSeismicEvents} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-8">
              <RadarControls />
              <PWSCard />
              <MetarCard />
              <PirepCard />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
