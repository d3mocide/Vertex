import { useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { NavTab } from '../../storeTypes'
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../config'
import { roleMeta } from '../../aircraftRoles'
import { flyMapTo, resetMapCamera, useMapSlot } from '../mapViewport'
import {
  formatRelativeAge,
  useDashboardData,
  useNearestMetar,
  useRecentP25Calls,
  type NotableAirItem,
  type NotableVesselItem,
  type SituationItem,
} from './dashboard/useDashboardData'
import { useDashboardHistory, useEmsActivity, useForecast } from './dashboard/feeds'
import { CardLink, GlassCard } from './dashboard/ui'
import {
  BriefingView,
  DispatchMixView,
  ForecastView,
  KpiTile,
  SituationCounts,
  SituationList,
  TalkgroupBars,
  postureClass,
} from './dashboard/sections'

interface MapFocusBanner {
  label: string
  detail: string
  tone: 'cyan' | 'green' | 'red' | 'amber'
  entityId?: string
  incidentId?: string
  tab?: NavTab
}

function aqiTextClass(aqi: number | undefined): string {
  if (aqi == null) return 'text-on-surface-variant'
  if (aqi <= 50) return 'text-green-ais'
  if (aqi <= 100) return 'text-amber-gold'
  if (aqi <= 150) return 'text-amber-p25'
  return 'text-red-emergency'
}

function metarBadgeClass(cat: string): string {
  if (cat === 'VFR') return 'border-green-ais/60 bg-green-ais/10 text-green-ais'
  if (cat === 'MVFR') return 'border-cyan-adsb/60 bg-cyan-adsb/10 text-cyan-adsb'
  if (cat === 'IFR') return 'border-amber-gold/60 bg-amber-gold/10 text-amber-gold'
  return 'border-red-emergency/60 bg-red-emergency/15 text-red-emergency'
}

function toneTextClass(tone: MapFocusBanner['tone']): string {
  if (tone === 'cyan') return 'text-cyan-adsb'
  if (tone === 'green') return 'text-green-ais'
  if (tone === 'red') return 'text-red-emergency'
  return 'text-amber-gold'
}

const CHIP_OFF = 'bg-onyx-black/70 border-white/15 text-on-surface-variant hover:text-on-surface'

export function DesktopDashboard() {
  const mapSlotRef = useRef<HTMLDivElement | null>(null)
  useMapSlot(mapSlotRef, true)

  const {
    setActiveTab,
    setWallMode,
    selectEntity,
    selectedEntityId,
    setFocusIncidentId,
    radarVisible,
    setRadarVisible,
    dispatchVisible,
    setDispatchVisible,
    trailsVisible,
    setTrailsVisible,
  } = useCivicPick(
    'setActiveTab',
    'setWallMode',
    'selectEntity',
    'selectedEntityId',
    'setFocusIncidentId',
    'radarVisible',
    'setRadarVisible',
    'dispatchVisible',
    'setDispatchVisible',
    'trailsVisible',
    'setTrailsVisible',
  )

  const data = useDashboardData()
  const recentCalls = useRecentP25Calls(true)
  const metar = useNearestMetar(true)
  const history = useDashboardHistory()
  const forecast = useForecast()
  const ems = useEmsActivity()
  const [focusBanner, setFocusBanner] = useState<MapFocusBanner | null>(null)

  const focusAir = (item: NotableAirItem) => {
    selectEntity(item.id)
    if (item.lon != null && item.lat != null) flyMapTo(item.lon, item.lat, 11.5)
    const parts = [
      item.alertLabel ?? item.roleLabel ?? (item.model ? item.model.toUpperCase() : 'AIRCRAFT'),
      item.altFt != null ? `${item.altFt.toLocaleString()} FT` : null,
      item.speedKt != null ? `${item.speedKt} KT` : null,
      item.distKm != null ? `${item.distKm.toFixed(1)} KM` : null,
    ].filter(Boolean)
    setFocusBanner({ label: item.callsign, detail: parts.join(' · '), tone: item.alert ? 'red' : 'cyan', entityId: item.id })
  }

  const focusVessel = (item: NotableVesselItem) => {
    selectEntity(item.id)
    if (item.lon != null && item.lat != null) flyMapTo(item.lon, item.lat, 12)
    const parts = [
      item.shipType ?? (item.underway ? 'UNDERWAY' : 'VESSEL'),
      item.speedKt != null ? `${item.speedKt} KT` : null,
      item.distKm != null ? `${item.distKm.toFixed(1)} KM` : null,
    ].filter(Boolean)
    setFocusBanner({ label: item.name, detail: parts.join(' · '), tone: 'green', entityId: item.id })
  }

  const focusSituation = (it: SituationItem) => {
    if (it.lat == null || it.lon == null) {
      if (it.incidentId) setFocusIncidentId(it.incidentId)
      setActiveTab(it.tab)
      return
    }
    flyMapTo(it.lon, it.lat, 13)
    setFocusBanner({
      label: it.title.toUpperCase(),
      detail: it.detail,
      tone: it.tone === 'red' ? 'red' : 'amber',
      incidentId: it.incidentId,
      tab: it.incidentId ? undefined : it.tab,
    })
  }

  const openIncident = (id: string) => {
    setFocusIncidentId(id)
    setActiveTab('incidents')
  }

  const radioActive = data.radio?.state === 'call' || data.radio?.state === 'encrypted'
  const radioTag = data.radio?.tag || (data.radio?.tgid ? `TG ${data.radio.tgid}` : 'P25 RADIO')

  const shownAir = data.notableAir.slice(0, 4)
  const shownVessels = data.notableVessels.slice(0, 4)
  const underway = data.notableVessels.filter((v) => v.underway).length
  const s = history?.series
  const t = history?.totals
  const callsThisHour = (s ? s.radio_call[s.radio_call.length - 1] ?? null : null)
  const life = data.situation.filter((i) => i.tone === 'red').length

  return (
    <div
      className="w-full h-full pointer-events-none overflow-y-auto custom-scrollbar"
      role="region"
      aria-label="Command dashboard"
    >
      <div className="flex flex-col gap-2.5 p-2.5 pb-24">
        {/* ── KPI strip: now, the last 24 h, and the hourly shape of the day ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 pointer-events-none">
          <KpiTile
            icon="flight" label="Aircraft" colorClass="text-cyan-adsb"
            now={data.totalAircraft} nowLabel="tracked now"
            total={t?.aircraft} series={s?.aircraft}
            extra={`${data.notableAir.filter((a) => !a.fallbackNearby).length} flagged`}
          />
          <KpiTile
            icon="sailing" label="Vessels" colorClass="text-green-ais"
            now={data.totalVessels} nowLabel="tracked now"
            total={t?.vessel} series={s?.vessel}
            extra={`${underway} underway`}
          />
          <KpiTile
            icon="cell_tower" label="Radio calls" colorClass="text-amber-p25"
            now={callsThisHour ?? '—'} nowLabel="this hour"
            total={t?.radio_call} series={s?.radio_call}
            extra={radioActive ? `RX · ${radioTag}` : 'Standby'}
          />
          <KpiTile
            icon="emergency" label="Dispatch" colorClass={life > 0 ? 'text-red-emergency' : 'text-amber-gold'}
            now={data.activeDispatch.length} nowLabel="active"
            total={t?.dispatch_incident} series={s?.dispatch_incident}
            extra={`${history?.life_safety_24h ?? 0} life-safety in 24h`}
          />
          <KpiTile
            icon="hub" label="Mesh nodes" colorClass="text-lime-rf"
            now={data.meshNodeCount} nowLabel="known"
            total={t?.mesh_node} totalLabel="HEARD 24H" series={s?.mesh_node}
            extra={data.latestMesh[0] ? `Last msg ${formatRelativeAge(data.latestMesh[0].timestamp, data.nowMs)} ago` : 'No messages yet'}
          />
          <KpiTile
            icon="partly_cloudy_day" label="Weather" colorClass="text-on-surface"
            now={data.weather.temp_f != null ? `${Math.round(data.weather.temp_f)}°F` : '—'}
            nowLabel={data.weather.condition ?? ''}
            extra={
              <>
                {data.weather.wind_mph != null ? `${data.weather.wind_dir ?? ''} ${Math.round(data.weather.wind_mph)} mph` : ''}
                {data.weather.wind_gust_mph ? ` G${Math.round(data.weather.wind_gust_mph)}` : ''}
                {data.weather.aqi != null && <span className={aqiTextClass(data.weather.aqi)}> · AQI {data.weather.aqi}</span>}
                {metar && <span> · {metar.icao} {metar.flightCategory}</span>}
              </>
            }
            series={forecast?.hourly.slice(0, 24).map((h) => h.pop ?? 0) ?? null}
            axis={['NOW', 'RAIN % +12H', '+24H']}
            seriesLabel="Chance of rain, next 24 hours by hour"
            total={null}
          />
        </div>

        {/* ── Map + briefing / situation board ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2.5 lg:h-[62vh] lg:min-h-[460px] pointer-events-none">
          <section
            className="relative flex flex-col min-h-[340px] border border-white/15 pointer-events-none"
            aria-label="Live tactical map viewport"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-onyx-black/60 backdrop-blur-md border-b border-white/10 pointer-events-auto shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-amber-gold leading-none" aria-hidden="true">my_location</span>
                <h2 className="section-heading mb-0! truncate">Live Tactical Map</h2>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setWallMode(true)}
                  className="font-mono text-[10px] uppercase tracking-widest text-amber-gold border border-amber-gold/40 px-2 py-0.5 hover:bg-amber-gold hover:text-onyx-black transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
                  title="Switch to the passive zero-scroll wall display"
                >
                  Wall Mode
                </button>
                <CardLink label="Full Map" onClick={() => setActiveTab('safety')} />
              </div>
            </div>

            <div ref={mapSlotRef} className="relative flex-1 min-h-[260px] bg-transparent pointer-events-none">
              <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none z-10">
                <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => setRadarVisible(!radarVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${radarVisible ? 'bg-amber-gold/20 border-amber-gold text-amber-gold' : CHIP_OFF}`}
                  >
                    Radar {radarVisible ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchVisible(!dispatchVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${dispatchVisible ? 'bg-amber-p25/20 border-amber-p25 text-amber-p25' : CHIP_OFF}`}
                  >
                    Dispatch
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrailsVisible(!trailsVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${trailsVisible ? 'bg-cyan-adsb/20 border-cyan-adsb text-cyan-adsb' : CHIP_OFF}`}
                  >
                    Trails
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetMapCamera(DEFAULT_CENTER, DEFAULT_ZOOM)
                    setFocusBanner(null)
                  }}
                  className={`pointer-events-auto px-2 py-0.5 border font-mono text-[10px] uppercase tracking-wider backdrop-blur-md transition-colors flex items-center gap-1 hover:text-amber-gold hover:border-amber-gold/50 ${CHIP_OFF}`}
                  title="Recenter map on region"
                >
                  <span className="ms text-[12px] leading-none" aria-hidden="true">center_focus_strong</span>
                  Reset
                </button>
              </div>

              {focusBanner && (
                <div className="absolute bottom-2 left-2 right-12 z-10 pointer-events-auto bg-onyx-black/75 border border-amber-gold/50 px-2.5 py-1.5 backdrop-blur-md flex items-center justify-between gap-3">
                  <div className="min-w-0 font-mono text-[11px] truncate">
                    <span className={`font-bold ${toneTextClass(focusBanner.tone)}`}>{focusBanner.label}</span>
                    {focusBanner.detail && <span className="text-on-surface-variant"> · {focusBanner.detail}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {focusBanner.incidentId && (
                      <button type="button" onClick={() => openIncident(focusBanner.incidentId!)} className="font-mono text-[10px] uppercase tracking-wider text-amber-gold hover:text-white">
                        Open →
                      </button>
                    )}
                    {focusBanner.tab && (
                      <button type="button" onClick={() => setActiveTab(focusBanner.tab!)} className="font-mono text-[10px] uppercase tracking-wider text-amber-gold hover:text-white">
                        Details →
                      </button>
                    )}
                    {focusBanner.entityId && (
                      <button
                        type="button"
                        onClick={() => {
                          selectEntity(focusBanner.entityId!)
                          setActiveTab('safety')
                        }}
                        className="font-mono text-[10px] uppercase tracking-wider text-amber-gold hover:text-white"
                      >
                        Track →
                      </button>
                    )}
                    <button type="button" onClick={() => setFocusBanner(null)} className="text-on-surface-variant hover:text-on-surface" aria-label="Dismiss target readout">
                      <span className="ms text-[14px] leading-none">close</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="flex flex-col gap-2.5 min-h-0 pointer-events-none">
            <GlassCard
              icon="psychology"
              title="AI Briefing"
              tone={data.posture === 'HIGH' ? 'red' : data.posture === 'ELEVATED' ? 'amber' : undefined}
              className="shrink-0 lg:max-h-[55%]"
              bodyClass="overflow-y-auto custom-scrollbar"
              right={
                <>
                  <span className={`font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${postureClass(data.posture)}`}>
                    {data.posture}
                  </span>
                  <CardLink label="Incidents" onClick={() => setActiveTab('incidents')} />
                </>
              }
            >
              <BriefingView digest={data.briefing} ts={data.summary.ts} nowMs={data.nowMs} />
            </GlassCard>

            <GlassCard
              icon="report"
              title="Situation"
              tone={life > 0 ? 'red' : data.situation.length > 0 ? 'amber' : undefined}
              className="flex-1 min-h-[180px]"
              bodyClass="overflow-y-auto custom-scrollbar"
              right={<SituationCounts items={data.situation} />}
            >
              <SituationList items={data.situation} nowMs={data.nowMs} onSelect={focusSituation} />
            </GlassCard>
          </div>
        </div>

        {/* ── Air & sea · weather · radio ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 pointer-events-none">
          <GlassCard
            icon="radar"
            title="Notable Air & Sea"
            right={<CardLink label="Flights" onClick={() => setActiveTab('flightlog')} />}
          >
            {shownAir.length === 0 && shownVessels.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px] text-on-surface-variant">No flagged or airborne-nearby aircraft and no vessels in range.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {shownAir.map((air) => {
                  const rm = roleMeta(air.role)
                  const selected = selectedEntityId === air.id
                  return (
                    <button
                      key={air.id}
                      type="button"
                      onClick={() => focusAir(air)}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 border-l-2 transition-colors hover:bg-white/5 ${
                        selected ? 'bg-amber-gold/10 border-l-amber-gold' : air.alert ? 'bg-red-emergency/10 border-l-red-emergency' : 'border-l-cyan-adsb/40'
                      }`}
                    >
                      <span className="ms text-[15px] leading-none text-cyan-adsb shrink-0" aria-hidden="true">flight</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-cyan-adsb truncate">{air.callsign}</span>
                          {air.alertLabel && (
                            <span className="font-mono text-[9px] font-bold uppercase px-1 border border-red-emergency bg-red-emergency/15 text-red-emergency shrink-0">{air.alertLabel}</span>
                          )}
                          {!air.alertLabel && air.roleLabel && (
                            <span className={`font-mono text-[9px] font-bold uppercase px-1 border shrink-0 ${rm ? `${rm.text} ${rm.border}` : 'text-on-surface-variant border-white/20'}`}>{air.roleLabel}</span>
                          )}
                          {air.fallbackNearby && <span className="font-mono text-[9px] uppercase text-on-surface-variant/70 shrink-0">NEAREST</span>}
                        </div>
                        <div className="font-mono text-[10px] text-on-surface-variant truncate">
                          {[air.model, air.altFt != null ? `${air.altFt.toLocaleString()} ft` : null, air.speedKt != null ? `${air.speedKt} kt` : null]
                            .filter(Boolean).join(' · ') || 'Live ADS-B track'}
                        </div>
                      </div>
                      <div className={`font-mono text-[10px] shrink-0 ${selected ? 'text-amber-gold font-bold' : 'text-on-surface'}`}>
                        {air.distKm != null ? `${air.distKm.toFixed(1)} km` : '—'}
                      </div>
                    </button>
                  )
                })}
                {shownVessels.map((v) => {
                  const selected = selectedEntityId === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => focusVessel(v)}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 border-l-2 transition-colors hover:bg-white/5 ${selected ? 'bg-amber-gold/10 border-l-amber-gold' : 'border-l-green-ais/40'}`}
                    >
                      <span className="ms text-[15px] leading-none text-green-ais shrink-0" aria-hidden="true">sailing</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-green-ais truncate">{v.name}</span>
                          {v.shipType && <span className="font-mono text-[9px] uppercase text-on-surface-variant truncate">{v.shipType}</span>}
                        </div>
                        <div className="font-mono text-[10px] text-on-surface-variant truncate">
                          {[v.navStatus ?? (v.underway ? 'Underway' : 'Stationary'), v.speedKt != null ? `${v.speedKt} kt` : null, v.heading != null ? `HDG ${Math.round(v.heading)}°` : null]
                            .filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className={`font-mono text-[10px] shrink-0 ${selected ? 'text-amber-gold font-bold' : 'text-on-surface'}`}>
                        {v.distKm != null ? `${v.distKm.toFixed(1)} km` : '—'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </GlassCard>

          <GlassCard
            icon="partly_cloudy_day"
            title="Weather & Forecast"
            right={
              <>
                {metar && (
                  <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${metarBadgeClass(metar.flightCategory)}`}>
                    {metar.icao} {metar.flightCategory}
                  </span>
                )}
                <CardLink label="Env" onClick={() => setActiveTab('environment')} />
              </>
            }
          >
            <div className="grid grid-cols-4 divide-x divide-white/5 border-b border-white/6">
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Temp</div>
                <div className="font-mono text-[15px] font-bold text-on-surface leading-tight mt-0.5">
                  {data.weather.temp_f != null ? `${Math.round(data.weather.temp_f)}°F` : '—'}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate">
                  {data.weather.humidity != null ? `${Math.round(data.weather.humidity)}% RH` : (data.weather.condition ?? '')}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Wind</div>
                <div className="font-mono text-[15px] font-bold text-on-surface leading-tight mt-0.5">
                  {data.weather.wind_mph != null ? `${Math.round(data.weather.wind_mph)}` : '—'}<span className="text-[10px] font-normal"> mph</span>
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate">
                  {[data.weather.wind_dir, data.weather.wind_gust_mph ? `G ${Math.round(data.weather.wind_gust_mph)}` : null].filter(Boolean).join(' · ') || 'Calm'}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">AQI</div>
                <div className={`font-mono text-[15px] font-bold leading-tight mt-0.5 ${aqiTextClass(data.weather.aqi)}`}>{data.weather.aqi ?? '—'}</div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate">{data.weather.aqi_label ?? 'Air quality'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Wildfire</div>
                <div className={`font-mono text-[15px] font-bold leading-tight mt-0.5 ${data.nearestFireKm != null && data.nearestFireKm < 50 ? 'text-amber-gold' : 'text-on-surface'}`}>
                  {data.fireHazardCount}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate">
                  {data.nearestFireKm != null ? `nearest ${Math.round(data.nearestFireKm)} km` : 'none tracked'}
                  {data.lightningCount > 0 ? ` · ${data.lightningCount} ltg` : ''}
                </div>
              </div>
            </div>
            <ForecastView forecast={forecast} />
          </GlassCard>

          <GlassCard
            icon="cell_tower"
            title="P25 Radio"
            titleClass="text-amber-p25!"
            iconClass="text-amber-p25"
            tone={radioActive ? 'p25' : undefined}
            right={
              <>
                <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${radioActive ? 'border-amber-p25 bg-amber-p25/15 text-amber-p25' : 'border-white/15 text-on-surface-variant'}`}>
                  {data.radio?.state === 'encrypted' ? 'ENCRYPTED' : radioActive ? 'RX ACTIVE' : 'STANDBY'}
                </span>
                <CardLink label="Comms" onClick={() => setActiveTab('comms')} />
              </>
            }
          >
            {radioActive && (
              <div className="px-3 py-2 bg-amber-p25/12 border-b border-amber-p25/40 flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-amber-p25 animate-pulse shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1 font-mono text-[11px] font-bold text-amber-p25 uppercase truncate">
                  {radioTag}
                  {data.radio?.freq_hz ? ` · ${(data.radio.freq_hz / 1e6).toFixed(4)} MHz` : ''}
                </div>
              </div>
            )}
            {recentCalls.length === 0 ? (
              <div className="px-3 py-3 font-mono text-[11px] text-on-surface-variant">
                {radioActive ? 'Monitoring live transmission…' : 'No P25 transmissions recorded in the last 6 hours.'}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {recentCalls
                  .filter((c) => c.transcription?.trim())
                  .concat(recentCalls.filter((c) => !c.transcription?.trim()))
                  .slice(0, 4)
                  .map((call) => {
                    const text = call.transcription?.trim()
                    return (
                      <div key={call.id} className="px-3 py-1.5 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-[10px] font-bold text-amber-p25 truncate">
                            {call.tag || `TG ${call.tgid}`}
                            {call.duration_s != null && <span className="text-on-surface-variant font-normal"> · {Math.round(call.duration_s)}s</span>}
                          </span>
                          <p className={`text-[11px] leading-snug line-clamp-2 ${text ? 'text-on-surface' : 'text-on-surface-variant/50 italic'}`}>
                            {text ? `“${text}”` : call.transcription == null ? 'Transcribing…' : 'No speech detected'}
                          </p>
                        </div>
                        <span className="font-mono text-[10px] text-on-surface-variant shrink-0">{formatRelativeAge(call.started_at, data.nowMs)}</span>
                      </div>
                    )
                  })}
              </div>
            )}
            <TalkgroupBars history={history} />
          </GlassCard>
        </div>

        {/* ── Dispatch & EMS against the usual · mesh ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2.5 pointer-events-none">
          <GlassCard
            icon="monitoring"
            title="Dispatch & EMS · Last 24 Hours"
            right={<CardLink label="Incidents" onClick={() => setActiveTab('incidents')} />}
          >
            <DispatchMixView feed={data.radioIncidents} history={history} ems={ems} />
          </GlassCard>

          <GlassCard
            icon="hub"
            title="MeshCore"
            titleClass="text-lime-rf!"
            iconClass="text-lime-rf"
            right={<CardLink label="Comms" onClick={() => setActiveTab('comms')} />}
            bodyClass="max-h-[260px] overflow-y-auto custom-scrollbar"
          >
            {data.latestMesh.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px] text-on-surface-variant">No MeshCore traffic received yet.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {data.latestMesh.slice(0, 8).map((msg) => (
                  <div key={msg.key} className="px-3 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[11px] font-bold text-lime-rf truncate">{msg.sender}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant border border-white/10 px-1 shrink-0">#{msg.channel}</span>
                      </span>
                      <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
                        {msg.snr != null && <span className="text-lime-rf">{msg.snr >= 0 ? `+${msg.snr.toFixed(1)}` : msg.snr.toFixed(1)} dB · </span>}
                        {formatRelativeAge(msg.timestamp, data.nowMs)}
                      </span>
                    </div>
                    <p className="text-[11px] text-on-surface leading-snug line-clamp-2 mt-0.5">{msg.text}</p>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  )
}
