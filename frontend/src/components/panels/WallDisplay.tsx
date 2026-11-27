import { useEffect, useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { SummaryPosture } from '../../storeTypes'
import { regionInfo } from '../../config'
import { roleMeta } from '../../aircraftRoles'
import { CATEGORY } from './RadioIncidents'
import { flyMapTo, useMapSlot } from '../mapViewport'
import {
  formatRelativeAge,
  useDashboardData,
  useNearestMetar,
  useRecentP25Calls,
} from './dashboard/useDashboardData'

function postureWallClass(posture: SummaryPosture): string {
  if (posture === 'HIGH') return 'border-red-emergency bg-red-emergency/20 text-red-emergency shadow-red-glow'
  if (posture === 'ELEVATED') return 'border-amber-gold bg-amber-gold/15 text-amber-gold shadow-gold-sm'
  return 'border-green-ais bg-green-ais/15 text-green-ais'
}

function aqiTone(aqi: number | undefined): string {
  if (aqi == null) return 'text-on-surface-variant'
  if (aqi <= 50) return 'text-green-ais'
  if (aqi <= 100) return 'text-amber-gold'
  if (aqi <= 150) return 'text-amber-p25'
  return 'text-red-emergency'
}

export function WallDisplay() {
  const mapSlotRef = useRef<HTMLDivElement | null>(null)
  useMapSlot(mapSlotRef, true)

  const { setWallMode, selectEntity, radarVisible, setRadarVisible } = useCivicPick(
    'setWallMode',
    'selectEntity',
    'radarVisible',
    'setRadarVisible',
  )

  const data = useDashboardData()
  const recentCalls = useRecentP25Calls(true)
  const metar = useNearestMetar(true)

  const [clock, setClock] = useState(() =>
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  )
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWallMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setWallMode])

  const radioActive = data.radio?.state === 'call' || data.radio?.state === 'encrypted'
  const latestCall = recentCalls.find((c) => c.transcription?.trim()) ?? recentCalls[0] ?? null
  const activeCallTag = radioActive
    ? (data.radio?.tag || (data.radio?.tgid ? `TG ${data.radio.tgid}` : 'LIVE TRANSMISSION'))
    : (latestCall?.tag || (latestCall ? `TG ${latestCall.tgid}` : 'P25 STANDBY'))

  const airTiles = data.notableAir.slice(0, 2)
  const seaTiles = data.notableVessels.slice(0, 2)
  const regionLabel = regionInfo.name ? `${regionInfo.name.toUpperCase()} SECTOR` : 'SITUATIONAL AWARENESS'

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none flex flex-col overflow-hidden"
      role="region"
      aria-label="Wall display mode"
    >
      {/* Top Telemetry Bar */}
      <header className="pointer-events-auto shrink-0 bg-onyx-deep border-b border-amber-gold/40 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Canonical Scope mark — Direction 07 */}
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0 text-white">
            <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
              <path d="M2 8 V2 H8"/>
              <path d="M24 2 H30 V8"/>
              <path d="M30 24 V30 H24"/>
              <path d="M8 30 H2 V24"/>
            </g>
            <polygon points="16,7 25,16 16,25 7,16" fill="none" stroke="currentColor" strokeWidth="2"/>
            <rect x="14" y="14" width="4" height="4" fill="#FFB800"/>
          </svg>
          <div className="min-w-0">
            <div className="flex items-center gap-2 leading-none">
              <span className="text-[16px] font-black tracking-wider text-white uppercase">VERTEX</span>
              <span className="font-mono text-[11px] tracking-widest text-on-surface-variant uppercase hidden sm:inline">
                // WALL DISPLAY
              </span>
            </div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-amber-gold uppercase mt-1 truncate">
              {regionLabel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className={`px-3 py-1 border font-mono text-[12px] font-bold uppercase tracking-widest flex items-center gap-2 ${postureWallClass(data.posture)}`}>
            <span
              className={`w-2 h-2 rounded-full ${
                data.posture === 'HIGH'
                  ? 'bg-red-emergency animate-pulse'
                  : data.posture === 'ELEVATED'
                    ? 'bg-amber-gold animate-pulse'
                    : 'bg-green-ais'
              }`}
              aria-hidden="true"
            />
            POSTURE: {data.posture}
          </div>

          <div className="hidden md:flex items-center gap-3 font-mono text-[13px] text-on-surface">
            <span>
              <strong>{data.weather.temp_f != null ? `${Math.round(data.weather.temp_f)}°F` : '—'}</strong>
              {data.weather.wind_mph != null && (
                <span className="text-on-surface-variant ml-1.5">
                  {data.weather.wind_dir ? `${data.weather.wind_dir} ` : ''}
                  {Math.round(data.weather.wind_mph)} MPH
                </span>
              )}
            </span>
            <span className="text-white/20" aria-hidden="true">·</span>
            <span className={`font-bold ${aqiTone(data.weather.aqi)}`}>
              AQI {data.weather.aqi ?? '—'}
            </span>
            {metar && (
              <>
                <span className="text-white/20" aria-hidden="true">·</span>
                <span className="text-cyan-adsb font-bold">{metar.flightCategory}</span>
              </>
            )}
          </div>

          <div className="font-mono text-[20px] font-bold tracking-wider text-white tabular-nums">
            {clock}
          </div>

          <button
            type="button"
            onClick={() => setWallMode(false)}
            className="btn-ghost py-1! px-2.5! flex items-center gap-1"
            title="Exit Wall Display (Esc)"
          >
            <span className="ms text-[14px] leading-none" aria-hidden="true">fullscreen_exit</span>
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </header>

      {/* Main Zero-Scroll Ops Board */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.22fr_1fr] gap-3 p-3 pointer-events-none">
        {/* LEFT: Large Live Tactical Map + High-Contrast P25 Transcript Banner */}
        <div className="flex flex-col gap-3 min-h-0 pointer-events-none">
          <div
            ref={mapSlotRef}
            className="relative flex-1 min-h-[260px] border border-white/15 bg-transparent pointer-events-none"
          >
            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none z-10">
              <button
                type="button"
                onClick={() => setRadarVisible(!radarVisible)}
                className={`pointer-events-auto px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider border backdrop-blur-md ${
                  radarVisible
                    ? 'bg-amber-gold/20 border-amber-gold text-amber-gold'
                    : 'bg-onyx-black/85 border-white/20 text-on-surface-variant'
                }`}
              >
                LIVE MAP · RADAR {radarVisible ? 'ON' : 'OFF'}
              </button>
              <div className="pointer-events-auto px-2.5 py-1 bg-onyx-black/85 border border-white/20 backdrop-blur-md font-mono text-[11px] tracking-wider flex items-center gap-2.5">
                <span className="text-cyan-adsb font-bold">AIR {data.totalAircraft}</span>
                <span className="text-white/25">·</span>
                <span className="text-green-ais font-bold">SEA {data.totalVessels}</span>
                <span className="text-white/25">·</span>
                <span className="text-lime-rf font-bold">MESH {data.meshNodeCount}</span>
                <span
                  className={`w-2 h-2 rounded-full ${data.connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency'}`}
                  title={data.connected ? 'WebSocket live' : 'Disconnected'}
                />
              </div>
            </div>
          </div>

          {/* High-Contrast Live P25 Transcript Banner */}
          <section
            className={`pointer-events-auto shrink-0 border p-3.5 ${
              radioActive
                ? 'border-amber-p25 bg-amber-p25/12'
                : 'border-white/15 bg-onyx-deep/95'
            }`}
            aria-label="Live P25 radio transcript"
          >
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${radioActive ? 'bg-amber-p25 animate-pulse' : 'bg-on-surface-variant/40'}`}
                  aria-hidden="true"
                />
                <span className="font-mono text-[12px] font-bold uppercase tracking-widest text-amber-p25 truncate">
                  {radioActive ? 'LIVE P25 · ' : 'LAST P25 · '}
                  {activeCallTag}
                </span>
              </div>
              <span className="font-mono text-[11px] text-on-surface-variant shrink-0">
                {radioActive && data.radio?.freq_hz
                  ? `${(data.radio.freq_hz / 1e6).toFixed(4)} MHz · NOW`
                  : latestCall
                    ? formatRelativeAge(latestCall.started_at, data.nowMs)
                    : 'STANDBY'}
              </span>
            </div>
            <p className="text-[15px] font-semibold leading-snug text-white line-clamp-2">
              {latestCall?.transcription?.trim()
                ? `“${latestCall.transcription.trim()}”`
                : radioActive
                  ? 'Receiving live voice traffic on channel…'
                  : 'Channel quiet — monitoring P25 trunked radio.'}
            </p>
          </section>
        </div>

        {/* RIGHT: 3 High-Contrast Zero-Scroll Blocks */}
        <div className="flex flex-col gap-3 min-h-0 pointer-events-none">
          {/* 1. Active Incidents */}
          <section
            className="pointer-events-auto bg-onyx-deep/95 border border-white/15 p-3.5 shrink-0"
            aria-label="Active incidents"
          >
            <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-white/10">
              <h2 className="section-heading mb-0! text-[12px]!">ACTIVE INCIDENTS</h2>
              <span className="font-mono text-[11px] text-amber-gold uppercase">
                {data.activeDispatch.length} DISPATCH · {data.weatherAlerts.length} NWS
              </span>
            </div>

            {data.isQuiet ? (
              <div className="px-3 py-3 border-l-4 border-l-green-ais bg-green-ais/10 font-mono text-[13px] font-bold text-green-ais uppercase">
                ALL CLEAR — NO ACTIVE DISPATCH OR SEVERE WEATHER ALERTS
              </div>
            ) : (
              <div className="stack-y-2">
                {data.activeDispatch.slice(0, 2).map((inc) => (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => {
                      if (inc.lon != null && inc.lat != null) flyMapTo(inc.lon, inc.lat, 13)
                    }}
                    className={`w-full text-left px-3 py-2 border-l-4 transition-colors hover:bg-white/5 ${
                      inc.severity >= 5
                        ? 'border-l-red-emergency bg-red-emergency/15'
                        : 'border-l-amber-gold bg-amber-gold/10'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[14px] font-bold text-white truncate">
                        {(inc.nature ?? CATEGORY[inc.category]?.label ?? 'Dispatch').toUpperCase()}
                        {inc.location ? ` · ${inc.location}` : ''}
                      </span>
                      <span className={`font-mono text-[11px] font-bold shrink-0 ${inc.severity >= 5 ? 'text-red-emergency' : 'text-amber-gold'}`}>
                        {formatRelativeAge(inc.last_seen, data.nowMs)}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-on-surface-variant truncate mt-0.5">
                      {[
                        inc.units.length > 0 ? inc.units.slice(0, 5).join(', ') : null,
                        inc.status === 'on_scene' ? 'ON SCENE' : 'ACTIVE',
                        inc.dist_km != null ? `${inc.dist_km.toFixed(1)} KM` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}

                {data.weatherAlerts.slice(0, data.activeDispatch.length >= 2 ? 1 : 2).map((alert, idx) => (
                  <div
                    key={`wall-wx-${idx}`}
                    className="px-3 py-2 border-l-4 border-l-amber-gold bg-amber-gold/10"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-white uppercase truncate">
                        NWS · {alert.event}
                      </span>
                      <span className="font-mono text-[11px] text-amber-gold uppercase shrink-0">
                        {alert.severity}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-on-surface-variant truncate mt-0.5">
                      {alert.area_desc || alert.headline}
                    </div>
                  </div>
                ))}

                {data.activeDispatch.length === 0 && data.weatherAlerts.length === 0 && data.briefingLead && (
                  <p className="text-[13px] text-on-surface leading-snug line-clamp-3">{data.briefingLead}</p>
                )}
              </div>
            )}
          </section>

          {/* 2. Notable Air & Sea 2x2 Grid */}
          <section
            className="pointer-events-auto bg-onyx-deep/95 border border-white/15 p-3.5 shrink-0"
            aria-label="Notable air and sea tracks"
          >
            <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-white/10">
              <h2 className="section-heading mb-0! text-[12px]! text-cyan-adsb!">NOTABLE AIR &amp; SEA</h2>
              <span className="font-mono text-[11px] text-on-surface-variant">
                {data.totalAircraft} AIR · {data.totalVessels} SEA
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {airTiles.map((air) => {
                const rm = roleMeta(air.role)
                return (
                  <button
                    key={air.id}
                    type="button"
                    onClick={() => {
                      selectEntity(air.id)
                      if (air.lon != null && air.lat != null) flyMapTo(air.lon, air.lat, 11.5)
                    }}
                    className="text-left p-2.5 bg-white/2 border border-white/10 border-l-2 border-l-cyan-adsb hover:bg-white/5 transition-colors"
                  >
                    <div className="font-mono text-[14px] font-bold text-cyan-adsb truncate">{air.callsign}</div>
                    <div className={`font-mono text-[11px] font-bold truncate mt-0.5 ${air.alert ? 'text-red-emergency' : rm ? rm.text : 'text-on-surface'}`}>
                      {air.alertLabel ?? air.roleLabel ?? 'NEARBY'}
                      {air.altFt != null ? ` · ${air.altFt.toLocaleString()} FT` : ''}
                    </div>
                    <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                      {[
                        air.distKm != null ? `${air.distKm.toFixed(1)} KM` : null,
                        air.speedKt != null ? `${air.speedKt} KT` : null,
                      ].filter(Boolean).join(' · ') || 'ADS-B LIVE'}
                    </div>
                  </button>
                )
              })}

              {seaTiles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    selectEntity(v.id)
                    if (v.lon != null && v.lat != null) flyMapTo(v.lon, v.lat, 12)
                  }}
                  className="text-left p-2.5 bg-white/2 border border-white/10 border-l-2 border-l-green-ais hover:bg-white/5 transition-colors"
                >
                  <div className="font-mono text-[14px] font-bold text-green-ais truncate">{v.name}</div>
                  <div className="font-mono text-[11px] text-on-surface truncate mt-0.5">
                    {(v.shipType ?? (v.underway ? 'UNDERWAY' : 'VESSEL')).toUpperCase()}
                    {v.speedKt != null ? ` · ${v.speedKt} KT` : ''}
                  </div>
                  <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                    {v.distKm != null ? `${v.distKm.toFixed(1)} KM · AIS` : 'AIS LIVE'}
                  </div>
                </button>
              ))}

              {airTiles.length === 0 && seaTiles.length === 0 && (
                <div className="col-span-2 font-mono text-[12px] text-on-surface-variant py-2">
                  No flagged aircraft or vessels in range.
                </div>
              )}
            </div>
          </section>

          {/* 3. MeshCore Live */}
          <section
            className="pointer-events-auto bg-onyx-deep/95 border border-white/15 p-3.5 flex-1 min-h-0 flex flex-col"
            aria-label="MeshCore live feed"
          >
            <div className="flex items-center justify-between gap-2 pb-2 mb-2.5 border-b border-white/10 shrink-0">
              <h2 className="section-heading mb-0! text-[12px]! text-lime-rf!">MESHCORE LIVE</h2>
              <span className="font-mono text-[11px] text-lime-rf uppercase">
                {data.meshNodeCount} NODES ONLINE
              </span>
            </div>

            {data.latestMesh.length === 0 ? (
              <div className="font-mono text-[12px] text-on-surface-variant">
                No MeshCore messages received yet.
              </div>
            ) : (
              <div className="stack-y-2.5 flex-1 min-h-0 overflow-hidden">
                {data.latestMesh.slice(0, 3).map((msg, i) => (
                  <div
                    key={msg.key}
                    className={`border-l-2 pl-2.5 ${i === 0 ? 'border-l-lime-rf' : 'border-l-lime-rf/40'}`}
                  >
                    <div className="font-mono text-[11px] text-lime-rf flex items-center gap-2">
                      <span className="font-bold truncate">{msg.sender}</span>
                      <span className="text-on-surface-variant shrink-0">
                        · #{msg.channel} · {formatRelativeAge(msg.timestamp, data.nowMs)}
                      </span>
                    </div>
                    <p className="text-[13px] text-on-surface leading-snug line-clamp-2 mt-0.5">
                      {msg.text}
                    </p>
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
