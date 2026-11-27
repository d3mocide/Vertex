import { useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { RadioIncident, SummaryPosture } from '../../storeTypes'
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../../config'
import { roleMeta } from '../../aircraftRoles'
import { CATEGORY } from './RadioIncidents'
import { flyMapTo, resetMapCamera, useMapSlot } from '../mapViewport'
import {
  formatRelativeAge,
  useDashboardData,
  useNearestMetar,
  useRecentP25Calls,
  type NotableAirItem,
  type NotableVesselItem,
} from './dashboard/useDashboardData'

interface MapFocusBanner {
  label: string
  detail: string
  tone: 'cyan' | 'green' | 'red' | 'amber'
  entityId?: string
  incidentId?: string
}

function postureBadgeClass(posture: SummaryPosture): string {
  if (posture === 'HIGH') return 'border-red-emergency bg-red-emergency/15 text-red-emergency'
  if (posture === 'ELEVATED') return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-green-ais/60 bg-green-ais/10 text-green-ais'
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
  const [focusBanner, setFocusBanner] = useState<MapFocusBanner | null>(null)

  const focusAir = (item: NotableAirItem) => {
    selectEntity(item.id)
    if (item.lon != null && item.lat != null) {
      flyMapTo(item.lon, item.lat, 11.5)
    }
    const parts = [
      item.alertLabel ?? item.roleLabel ?? (item.model ? item.model.toUpperCase() : 'AIRCRAFT'),
      item.altFt != null ? `${item.altFt.toLocaleString()} FT` : null,
      item.speedKt != null ? `${item.speedKt} KT` : null,
      item.distKm != null ? `${item.distKm.toFixed(1)} KM` : null,
    ].filter(Boolean)
    setFocusBanner({
      label: item.callsign,
      detail: parts.join(' · '),
      tone: item.alert ? 'red' : 'cyan',
      entityId: item.id,
    })
  }

  const focusVessel = (item: NotableVesselItem) => {
    selectEntity(item.id)
    if (item.lon != null && item.lat != null) {
      flyMapTo(item.lon, item.lat, 12)
    }
    const parts = [
      item.shipType ?? (item.underway ? 'UNDERWAY' : 'VESSEL'),
      item.speedKt != null ? `${item.speedKt} KT` : null,
      item.distKm != null ? `${item.distKm.toFixed(1)} KM` : null,
    ].filter(Boolean)
    setFocusBanner({
      label: item.name,
      detail: parts.join(' · '),
      tone: 'green',
      entityId: item.id,
    })
  }

  const focusDispatch = (inc: RadioIncident) => {
    if (inc.lon != null && inc.lat != null) {
      flyMapTo(inc.lon, inc.lat, 13)
    }
    const title = inc.nature ?? CATEGORY[inc.category]?.label ?? 'Dispatch'
    const where = [inc.location, inc.city].filter(Boolean).join(', ')
    const parts = [
      where || null,
      inc.units.length > 0 ? inc.units.slice(0, 4).join(', ') : null,
      inc.dist_km != null ? `${inc.dist_km.toFixed(1)} KM` : null,
    ].filter(Boolean)
    setFocusBanner({
      label: title.toUpperCase(),
      detail: parts.join(' · '),
      tone: inc.severity >= 5 ? 'red' : 'amber',
      incidentId: inc.id,
    })
  }

  const openIncident = (id: string) => {
    setFocusIncidentId(id)
    setActiveTab('incidents')
  }

  const radioActive = data.radio?.state === 'call' || data.radio?.state === 'encrypted'
  const radioTag = data.radio?.tag || (data.radio?.tgid ? `TG ${data.radio.tgid}` : 'P25 RADIO')
  const latestTranscribed = recentCalls.find((c) => c.transcription?.trim())

  const shownAir = data.notableAir.slice(0, 3)
  const shownVessels = data.notableVessels.slice(0, 3)
  const hazardCount = data.weatherAlerts.length + data.fireHazardCount + (data.lightningCount > 0 ? 1 : 0)

  return (
    <div
      className="w-full h-full pointer-events-none flex flex-col overflow-y-auto lg:overflow-hidden"
      role="region"
      aria-label="Command dashboard"
    >
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.24fr_1fr] gap-2.5 p-2.5 lg:pb-22">
        {/* ── LEFT COLUMN: Live Tactical Map + Notable Air & Sea + Weather ── */}
        <div className="flex flex-col gap-2.5 min-h-0 pointer-events-none">
          {/* Live Tactical Map Slot (transparent interior over shared <Map />) */}
          <section
            className="flex-1 min-h-[260px] flex flex-col border border-white/15 pointer-events-none"
            aria-label="Live tactical map viewport"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-onyx-deep/95 border-b border-white/10 pointer-events-auto shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-amber-gold leading-none" aria-hidden="true">my_location</span>
                <h2 className="section-heading mb-0! truncate">Live Tactical Map</h2>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setWallMode(true)}
                  className="font-mono text-[10px] uppercase tracking-widest text-amber-gold border border-amber-gold/40 px-2 py-0.5 hover:bg-amber-gold hover:text-onyx-black transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
                  title="Switch to passive zero-scroll wall display"
                >
                  Wall Mode
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('safety')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors focus:outline-hidden"
                >
                  Full Map →
                </button>
              </div>
            </div>

            {/* Transparent slot bound to root <Map /> */}
            <div ref={mapSlotRef} className="relative flex-1 min-h-[220px] bg-transparent pointer-events-none">
              {/* Top quick-toggle chips */}
              <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 pointer-events-none z-10">
                <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => setRadarVisible(!radarVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${
                      radarVisible
                        ? 'bg-amber-gold/20 border-amber-gold text-amber-gold'
                        : 'bg-onyx-black/80 border-white/15 text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Radar {radarVisible ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDispatchVisible(!dispatchVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${
                      dispatchVisible
                        ? 'bg-amber-p25/20 border-amber-p25 text-amber-p25'
                        : 'bg-onyx-black/80 border-white/15 text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Dispatch
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrailsVisible(!trailsVisible)}
                    className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider border backdrop-blur-md transition-colors ${
                      trailsVisible
                        ? 'bg-cyan-adsb/20 border-cyan-adsb text-cyan-adsb'
                        : 'bg-onyx-black/80 border-white/15 text-on-surface-variant hover:text-on-surface'
                    }`}
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
                  className="pointer-events-auto px-2 py-0.5 bg-onyx-black/80 border border-white/15 text-on-surface-variant hover:text-amber-gold hover:border-amber-gold/50 font-mono text-[10px] uppercase tracking-wider backdrop-blur-md transition-colors flex items-center gap-1"
                  title="Recenter map on region"
                >
                  <span className="ms text-[12px] leading-none" aria-hidden="true">center_focus_strong</span>
                  Reset
                </button>
              </div>

              {/* Bottom Selected Target HUD */}
              {focusBanner && (
                <div className="absolute bottom-2 left-2 right-12 z-10 pointer-events-auto bg-onyx-black/90 border border-amber-gold/50 px-2.5 py-1.5 backdrop-blur-md flex items-center justify-between gap-3">
                  <div className="min-w-0 font-mono text-[11px] truncate">
                    <span className={`font-bold ${toneTextClass(focusBanner.tone)}`}>{focusBanner.label}</span>
                    {focusBanner.detail && (
                      <span className="text-on-surface-variant"> · {focusBanner.detail}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {focusBanner.incidentId && (
                      <button
                        type="button"
                        onClick={() => openIncident(focusBanner.incidentId!)}
                        className="font-mono text-[10px] uppercase tracking-wider text-amber-gold hover:text-white"
                      >
                        Open →
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
                    <button
                      type="button"
                      onClick={() => setFocusBanner(null)}
                      className="text-on-surface-variant hover:text-on-surface"
                      aria-label="Dismiss target readout"
                    >
                      <span className="ms text-[14px] leading-none">close</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Notable Air & Sea Watch */}
          <section
            className="bg-onyx-deep/95 border border-white/10 pointer-events-auto flex flex-col shrink-0"
            aria-label="Notable air and sea traffic"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-white/2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-amber-gold leading-none" aria-hidden="true">radar</span>
                <h2 className="section-heading mb-0! truncate">Notable Air &amp; Sea Watch</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[10px] uppercase tracking-wider border border-cyan-adsb/50 bg-cyan-adsb/10 text-cyan-adsb px-1.5 py-0.5">
                  {data.totalAircraft} AIR
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider border border-green-ais/50 bg-green-ais/10 text-green-ais px-1.5 py-0.5">
                  {data.totalVessels} SEA
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('flightlog')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors"
                >
                  Flights →
                </button>
              </div>
            </div>

            {shownAir.length === 0 && shownVessels.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px] text-on-surface-variant">
                No aircraft or vessels tracked in range right now.
              </div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[210px] overflow-y-auto custom-scrollbar">
                {shownAir.map((air) => {
                  const rm = roleMeta(air.role)
                  const selected = selectedEntityId === air.id
                  return (
                    <button
                      key={air.id}
                      type="button"
                      onClick={() => focusAir(air)}
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 border-l-2 transition-colors hover:bg-white/5 ${
                        selected
                          ? 'bg-amber-gold/10 border-l-amber-gold'
                          : air.alert
                            ? 'bg-red-emergency/10 border-l-red-emergency'
                            : 'border-l-transparent'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-adsb shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-cyan-adsb truncate">{air.callsign}</span>
                          {air.alertLabel && (
                            <span className="font-mono text-[9px] font-bold uppercase px-1 border border-red-emergency bg-red-emergency/15 text-red-emergency shrink-0">
                              {air.alertLabel}
                            </span>
                          )}
                          {!air.alertLabel && air.roleLabel && (
                            <span className={`font-mono text-[9px] font-bold uppercase px-1 border shrink-0 ${rm ? `${rm.text} ${rm.border}` : 'text-on-surface-variant border-white/20'}`}>
                              {air.roleLabel}
                            </span>
                          )}
                          {air.fallbackNearby && (
                            <span className="font-mono text-[9px] uppercase text-on-surface-variant/70 shrink-0">NEARBY</span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-on-surface-variant truncate">
                          {[
                            air.model,
                            air.altFt != null ? `${air.altFt.toLocaleString()} ft` : null,
                            air.speedKt != null ? `${air.speedKt} kt` : null,
                          ].filter(Boolean).join(' · ') || 'Live ADS-B track'}
                        </div>
                      </div>
                      <div className="font-mono text-[10px] text-right shrink-0">
                        <div className={selected ? 'text-amber-gold font-bold' : 'text-on-surface'}>
                          {air.distKm != null ? `${air.distKm.toFixed(1)} KM` : '—'}
                        </div>
                        <div className="text-[9px] text-on-surface-variant uppercase">ADS-B</div>
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
                      className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 border-l-2 transition-colors hover:bg-white/5 ${
                        selected ? 'bg-amber-gold/10 border-l-amber-gold' : 'border-l-transparent'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-green-ais shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[11px] font-bold text-green-ais truncate">{v.name}</span>
                          {v.priorityVessel && (
                            <span className="font-mono text-[9px] font-bold uppercase px-1 border border-green-ais/60 bg-green-ais/10 text-green-ais shrink-0">
                              NOTABLE
                            </span>
                          )}
                          {!v.priorityVessel && v.shipType && (
                            <span className="font-mono text-[9px] uppercase text-on-surface-variant truncate">
                              {v.shipType}
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-on-surface-variant truncate">
                          {[
                            v.navStatus ?? (v.underway ? 'Underway' : 'Stationary'),
                            v.speedKt != null ? `${v.speedKt} kt` : null,
                            v.heading != null ? `HDG ${Math.round(v.heading)}°` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="font-mono text-[10px] text-right shrink-0">
                        <div className={selected ? 'text-amber-gold font-bold' : 'text-on-surface'}>
                          {v.distKm != null ? `${v.distKm.toFixed(1)} KM` : '—'}
                        </div>
                        <div className="text-[9px] text-on-surface-variant uppercase">AIS</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {/* Compact Weather & Hazards Strip */}
          <section
            className="bg-onyx-deep/95 border border-white/10 pointer-events-auto shrink-0"
            aria-label="Weather and hazards summary"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-white/2">
              <div className="flex items-center gap-2">
                <span className="ms text-[15px] text-amber-gold leading-none" aria-hidden="true">partly_cloudy_day</span>
                <h2 className="section-heading mb-0!">Weather &amp; Hazards</h2>
              </div>
              <div className="flex items-center gap-2">
                {metar && (
                  <span className={`font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${metarBadgeClass(metar.flightCategory)}`}>
                    {metar.icao} {metar.flightCategory}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab('environment')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors"
                >
                  Env →
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 divide-x divide-white/5">
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Temp</div>
                <div className="font-mono text-[15px] font-bold text-on-surface leading-tight mt-0.5">
                  {data.weather.temp_f != null ? `${Math.round(data.weather.temp_f)}°F` : '—'}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                  {data.weather.condition ?? 'Current'}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Wind</div>
                <div className="font-mono text-[15px] font-bold text-on-surface leading-tight mt-0.5">
                  {data.weather.wind_mph != null ? `${Math.round(data.weather.wind_mph)} mph` : '—'}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                  {[
                    data.weather.wind_dir,
                    data.weather.wind_gust_mph ? `G ${Math.round(data.weather.wind_gust_mph)}` : null,
                  ].filter(Boolean).join(' · ') || 'Steady'}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">AQI</div>
                <div className={`font-mono text-[15px] font-bold leading-tight mt-0.5 ${aqiTextClass(data.weather.aqi)}`}>
                  {data.weather.aqi != null ? data.weather.aqi : '—'}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                  {data.weather.aqi_label ?? 'Air quality'}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="label-caps text-[10px]">Hazards</div>
                <div className={`font-mono text-[15px] font-bold leading-tight mt-0.5 ${hazardCount > 0 ? 'text-amber-gold' : 'text-green-ais'}`}>
                  {hazardCount > 0 ? `${hazardCount} ACT` : 'CLEAR'}
                </div>
                <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                  {data.fireHazardCount} fire · {data.lightningCount} ltg
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── RIGHT COLUMN: Incidents & Briefing + P25 Radio Live + MeshCore Feed ── */}
        <div className="flex flex-col gap-2.5 min-h-0 pointer-events-none">
          {/* Incidents & Condensed AI Briefing (collapses neatly when quiet) */}
          <section
            className="bg-onyx-deep/95 border border-white/10 pointer-events-auto flex flex-col shrink-0"
            aria-label="Active incidents and AI briefing"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-white/2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-amber-gold leading-none" aria-hidden="true">report</span>
                <h2 className="section-heading mb-0! truncate">Incidents &amp; Briefing</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border ${postureBadgeClass(data.posture)}`}>
                  {data.posture}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('incidents')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors"
                >
                  Incidents →
                </button>
              </div>
            </div>

            {data.isQuiet ? (
              <div className="px-3 py-2.5 bg-green-ais/5 flex items-center justify-between gap-2 font-mono text-[11px] text-green-ais">
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <span className="w-2 h-2 rounded-full bg-green-ais shrink-0" aria-hidden="true" />
                  ALL CLEAR — No active high-priority incidents or advisories
                </span>
                <span className="text-[10px] text-on-surface-variant shrink-0 uppercase">Nominal</span>
              </div>
            ) : (
              <>
                {data.briefingLead && (
                  <div className="px-3 py-2 bg-amber-gold/6 border-b border-amber-gold/20 text-[12px] leading-snug text-on-surface">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-gold mr-1.5">
                      Briefing{data.summary.ts ? ` (${formatRelativeAge(data.summary.ts, data.nowMs)})` : ''}:
                    </span>
                    <span className="line-clamp-3">{data.briefingLead}</span>
                  </div>
                )}

                <div className="divide-y divide-white/5 max-h-[210px] overflow-y-auto custom-scrollbar">
                  {data.activeDispatch.slice(0, 3).map((inc) => (
                    <div
                      key={inc.id}
                      className={`px-3 py-2 flex items-center gap-2 border-l-2 hover:bg-white/5 transition-colors ${
                        inc.severity >= 5
                          ? 'border-l-red-emergency bg-red-emergency/8'
                          : 'border-l-amber-gold'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => focusDispatch(inc)}
                        className="flex-1 min-w-0 text-left focus:outline-hidden"
                      >
                        <div className="text-[12px] font-semibold text-on-surface truncate flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${inc.severity >= 5 ? 'bg-red-emergency' : 'bg-amber-gold'}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">
                            {inc.nature ?? CATEGORY[inc.category]?.label}
                            {inc.location ? ` · ${inc.location}` : ''}
                            {inc.city ? `, ${inc.city}` : ''}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                          {[
                            inc.units.length > 0 ? inc.units.slice(0, 4).join(', ') : null,
                            inc.status === 'on_scene' ? 'On Scene' : 'Active',
                            inc.dist_km != null ? `${inc.dist_km.toFixed(1)} km` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                      <div className="font-mono text-[10px] text-right shrink-0 flex flex-col items-end">
                        <span className={inc.severity >= 5 ? 'text-red-emergency font-bold' : 'text-amber-gold font-bold'}>
                          SEV {inc.severity}
                        </span>
                        <button
                          type="button"
                          onClick={() => openIncident(inc.id)}
                          className="text-on-surface-variant hover:text-amber-gold"
                        >
                          {formatRelativeAge(inc.last_seen, data.nowMs)} →
                        </button>
                      </div>
                    </div>
                  ))}

                  {data.weatherAlerts.slice(0, 2).map((alert, idx) => {
                    const severe = alert.severity === 'Extreme' || alert.severity === 'Severe'
                    return (
                      <button
                        key={`wx-alert-${idx}`}
                        type="button"
                        onClick={() => setActiveTab('environment')}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-l-2 hover:bg-white/5 transition-colors ${
                          severe ? 'border-l-red-emergency bg-red-emergency/8' : 'border-l-amber-gold/70'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[12px] font-semibold text-on-surface truncate">
                            NWS · {alert.event}
                          </div>
                          <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                            {alert.area_desc || alert.headline}
                          </div>
                        </div>
                        <span className={`font-mono text-[10px] uppercase shrink-0 ${severe ? 'text-red-emergency font-bold' : 'text-amber-gold'}`}>
                          {alert.severity}
                        </span>
                      </button>
                    )
                  })}

                  {data.activeDispatch.length === 0 && data.weatherAlerts.length === 0 && data.majorTraffic.slice(0, 2).map((tr, idx) => (
                    <button
                      key={`tr-${idx}`}
                      type="button"
                      onClick={() => setActiveTab('infrastructure')}
                      className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-l-2 border-l-amber-gold/60 hover:bg-white/5 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-on-surface truncate">{tr.title}</div>
                        {tr.location && (
                          <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">{tr.location}</div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] uppercase text-amber-gold shrink-0">TRAFFIC</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* P25 Radio Live Card */}
          <section
            className="bg-onyx-deep/95 border border-white/10 pointer-events-auto flex flex-col shrink-0"
            aria-label="Live P25 radio activity"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-white/2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-amber-p25 leading-none" aria-hidden="true">cell_tower</span>
                <h2 className="section-heading mb-0! text-amber-p25! truncate">P25 Radio Live</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border ${
                    radioActive
                      ? 'border-amber-p25 bg-amber-p25/15 text-amber-p25'
                      : 'border-white/15 text-on-surface-variant'
                  }`}
                >
                  {data.radio?.state === 'encrypted' ? 'ENCRYPTED' : radioActive ? 'RX ACTIVE' : 'STANDBY'}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('comms')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors"
                >
                  Comms →
                </button>
              </div>
            </div>

            {radioActive && (
              <div className="px-3 py-2 bg-amber-p25/12 border-b border-amber-p25/40 flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-amber-p25 animate-pulse shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] font-bold text-amber-p25 uppercase truncate">
                    {radioTag}
                    {data.radio?.tgid ? ` (TG ${data.radio.tgid})` : ''}
                    {data.radio?.freq_hz ? ` · ${(data.radio.freq_hz / 1e6).toFixed(4)} MHz` : ''}
                  </div>
                  {latestTranscribed?.transcription && (
                    <div className="text-[11px] text-on-surface truncate mt-0.5">
                      “{latestTranscribed.transcription}”
                    </div>
                  )}
                </div>
              </div>
            )}

            {recentCalls.length === 0 ? (
              <div className="px-3 py-3 font-mono text-[11px] text-on-surface-variant">
                {radioActive ? 'Monitoring live transmission…' : 'No recent P25 transmissions recorded.'}
              </div>
            ) : (
              <div className="divide-y divide-white/5 max-h-[168px] overflow-y-auto custom-scrollbar">
                {recentCalls.slice(0, 4).map((call) => {
                  const text = call.transcription?.trim()
                  return (
                    <div key={call.id} className="px-3 py-1.5 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-amber-p25 truncate">
                            {call.tag || `TG ${call.tgid}`}
                          </span>
                          {call.duration_s != null && (
                            <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
                              {Math.round(call.duration_s)}s
                            </span>
                          )}
                        </div>
                        <p className={`text-[11px] leading-snug line-clamp-1 mt-0.5 ${text ? 'text-on-surface-variant' : 'text-on-surface-variant/50 italic'}`}>
                          {text ? `“${text}”` : call.transcription == null ? 'Transcribing…' : 'No speech detected'}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
                        {formatRelativeAge(call.started_at, data.nowMs)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* MeshCore Live Feed */}
          <section
            className="bg-onyx-deep/95 border border-white/10 pointer-events-auto flex flex-col flex-1 min-h-[140px]"
            aria-label="MeshCore live feed"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-white/10 bg-white/2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="ms text-[15px] text-lime-rf leading-none" aria-hidden="true">hub</span>
                <h2 className="section-heading mb-0! text-lime-rf! truncate">MeshCore Feed</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 border border-lime-rf/50 bg-lime-rf/10 text-lime-rf">
                  {data.meshNodeCount} NODES
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('comms')}
                  className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant hover:text-amber-gold transition-colors"
                >
                  Comms →
                </button>
              </div>
            </div>

            {data.latestMesh.length === 0 ? (
              <div className="px-3 py-4 font-mono text-[11px] text-on-surface-variant">
                No MeshCore traffic received yet.
              </div>
            ) : (
              <div className="divide-y divide-white/5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {data.latestMesh.slice(0, 6).map((msg) => (
                  <div key={msg.key} className="px-3 py-1.5 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-bold text-lime-rf truncate">{msg.sender}</span>
                        <span className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant border border-white/10 px-1 shrink-0">
                          #{msg.channel}
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant leading-snug line-clamp-2 mt-0.5">
                        {msg.text}
                      </p>
                    </div>
                    <div className="font-mono text-[10px] text-right shrink-0">
                      {msg.snr != null && (
                        <div className="text-lime-rf">{msg.snr >= 0 ? `+${msg.snr.toFixed(1)}` : msg.snr.toFixed(1)} dB</div>
                      )}
                      <div className="text-on-surface-variant">{formatRelativeAge(msg.timestamp, data.nowMs)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
