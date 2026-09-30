import { useEffect, useState } from 'react'
import { useCivicStore, SystemEvent } from '../../store'
import { API_BASE, regionInfo } from '../../config'
import { authHeaders, clearToken } from '../../auth'
import { firePanelEntityFromEntity, type FirePanelEntity, type FireRelevance } from './environment/FireStatusCard'
import { FireSmokeCard } from './environment/FireSmokeCard'
import { GeohazardsCard } from './environment/GeohazardsCard'
import { OutlookCard } from './environment/OutlookCard'
import { WeatherAlertCard } from './environment/WeatherAlertCard'
import { RadarControls } from './environment/RadarMiniMap'
import { NearbyConditionsCard } from './environment/NearbyConditionsCard'
import { FeedAge } from '../common/FeedAge'
import { PageHeader, StatTiles, type Stat } from '../common/Page'

export function EnvironmentPanel() {
  const weather = useCivicStore((s) => s.weather)
  const liveSystemEvents = useCivicStore((s) => s.systemEvents)
  const entities = useCivicStore((s) => s.entities)
  const [recentEvents, setRecentEvents] = useState<SystemEvent[]>([])
  const [radarOpen, setRadarOpen] = useState(false)
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

  // Quakes: last 24 h, stored plus live. Disasters: last 72 h, regional only (distant
  // ones are recorded as severity "info" for the briefing), each GDACS event once.
  const dayAgo = Date.now() - 24 * 3600 * 1000
  const quakes = Array.from(
    new Map(
      [...recentEvents, ...liveSystemEvents].filter((ev) => ev.event_type === 'seismic' && Date.parse(ev.ts) >= dayAgo)
        .map((ev) => [ev.event_id, ev]),
    ).values(),
  ).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  const seenDisaster = new Set<string>()
  const disasters = recentEvents.filter((ev) => {
    if (ev.event_type !== 'gdacs' || ev.severity === 'info') return false
    const id = String((ev.details as { gdacs_event_id?: string })?.gdacs_event_id ?? ev.event_id)
    if (seenDisaster.has(id)) return false
    seenDisaster.add(id)
    return true
  })

  useEffect(() => {
    let cancelled = false

    const loadEvents = async () => {
      try {
        const res = await fetch(`${API_BASE}/events?hours=72`, { headers: authHeaders() })
        if (res.status === 401) { clearToken(); window.location.reload(); return }
        if (!res.ok) return
        const data = await res.json() as SystemEvent[]
        if (cancelled || !Array.isArray(data)) return
        setRecentEvents(data.filter((ev) => ev.event_type === 'seismic' || ev.event_type === 'gdacs'))
      } catch {
        // Keep last known list when request fails.
      }
    }

    loadEvents()
    const timer = setInterval(loadEvents, 60000)
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
    { label: 'Wind', value: weather.wind_mph != null ? `${Math.round(weather.wind_mph)} mph` : '—',
      hint: [weather.wind_dir, weather.wind_gust_mph ? `gusts ${Math.round(weather.wind_gust_mph)}` : null].filter(Boolean).join(' · ') || undefined },
    { label: 'Humidity', value: weather.humidity != null ? `${Math.round(weather.humidity)}%` : '—' },
    { label: 'Air quality', value: aqi ?? '—', tone: aqiTone, hint: weather.aqi_label ?? undefined },
  ]

  // All quiet is one line. Anything active: the alerts themselves, then only the hazards that are lit.
  const activeHazards = hazards.filter((h) => h.level !== 'none')
  const statusBlock = alertCount === 0 && activeHazards.length === 0 ? (
    <div className="hud-panel px-4 py-3 bg-onyx-deep/40 flex items-center gap-3" role="status">
      <span className="ms text-[18px] leading-none text-green-ais" aria-hidden="true">check_circle</span>
      <span className="label-caps !text-green-ais">ALL CLEAR</span>
      <span className="text-[12px] text-on-surface-variant">No NWS alerts for this region</span>
    </div>
  ) : (
    <section aria-label="Weather advisories" className="space-y-3">
      {weather.alerts.map((alert, i) => <WeatherAlertCard key={i} alert={alert} />)}
      {activeHazards.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" role="list" aria-label="Active hazards">
          {activeHazards.map((h) => (
            <span
              key={h.label}
              role="listitem"
              className={`h-8 px-2.5 flex items-center gap-1.5 border text-[11px] font-bold uppercase tracking-widest ${
                h.level === 'warning' ? 'border-red-emergency/50 bg-red-emergency/10 text-red-emergency'
                : 'border-amber-gold/50 bg-amber-gold/10 text-amber-gold'}`}
            >
              <span className="ms text-[16px] leading-none" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>{h.icon}</span>
              {h.label}<span className="font-mono">{h.level}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )

  const fireCard = (
    <FireSmokeCard localFires={localFires} regionalFires={regionalFires} aqi={weather.aqi} aqiLabel={weather.aqi_label} />
  )

  // Phones keep radar one tap away: it is a big dark panel that pushed everything else below the fold.
  const radar = isMobile ? (
    <div className="hud-panel bg-onyx-deep/40">
      <button
        type="button"
        onClick={() => setRadarOpen((v) => !v)}
        aria-expanded={radarOpen}
        className="w-full flex items-center gap-2 px-4 py-3 text-left focus:outline-none"
      >
        <span className="ms text-[16px] leading-none text-sky-400" aria-hidden="true">radar</span>
        <span className="label-caps">RADAR</span>
        <span className="ml-auto font-mono text-[11px] text-on-surface-variant">{radarOpen ? 'hide' : 'tap to view'}</span>
        <span className="ms text-[16px] leading-none text-on-surface-variant" aria-hidden="true">{radarOpen ? 'expand_less' : 'expand_more'}</span>
      </button>
      {radarOpen && <RadarControls />}
    </div>
  ) : <RadarControls />

  return (
    <div className="flex flex-col h-full z-10">
      <PageHeader
        icon="eco"
        title="Environment"
        subtitle={<span className="flex items-center gap-2">{regionInfo.name} <FeedAge feedKey="weather:current" prefix="Updated" className="text-[11px]" /></span>}
      />

      <div className="flex-1 overflow-y-auto min-h-0 pb-24">
        <div className="p-4 lg:p-6 space-y-4">
          {statusBlock}
          <StatTiles items={tiles} />
        </div>

        {isMobile ? (
          <div className="flex flex-col gap-4 px-4 pb-4">
            <OutlookCard />
            {radar}
            <NearbyConditionsCard />
            {fireCard}
            <GeohazardsCard quakes={quakes} disasters={disasters} />
          </div>
        ) : (
          <div className="flex gap-6 px-6 pb-6 items-start">
            <div className="flex-1 min-w-0 flex flex-col gap-6">
              <OutlookCard />
              {fireCard}
              <GeohazardsCard quakes={quakes} disasters={disasters} />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-6 sticky top-4">
              {radar}
              <NearbyConditionsCard />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
