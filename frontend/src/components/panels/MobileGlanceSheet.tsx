import { useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { SummaryPosture } from '../../storeTypes'
import { roleMeta } from '../../aircraftRoles'
import { CATEGORY } from './RadioIncidents'
import { flyMapTo } from '../mapViewport'
import {
  formatRelativeAge,
  useDashboardData,
  useRecentP25Calls,
} from './dashboard/useDashboardData'

type Detent = 'peek' | 'half' | 'full'
type StreamFilter = 'all' | 'incidents' | 'radio' | 'tracks' | 'mesh'

const DETENTS: Detent[] = ['peek', 'half', 'full']

const FILTERS: { id: StreamFilter; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'radio',     label: 'Radio' },
  { id: 'tracks',    label: 'Air/Sea' },
  { id: 'mesh',      label: 'Mesh' },
]

function posturePillClass(posture: SummaryPosture): string {
  if (posture === 'HIGH') return 'border-red-emergency bg-red-emergency/15 text-red-emergency'
  if (posture === 'ELEVATED') return 'border-amber-gold bg-amber-gold/10 text-amber-gold'
  return 'border-green-ais/60 bg-green-ais/10 text-green-ais'
}

function aqiTone(aqi: number | undefined): string {
  if (aqi == null) return 'text-on-surface-variant'
  if (aqi <= 50) return 'text-green-ais'
  if (aqi <= 100) return 'text-amber-gold'
  if (aqi <= 150) return 'text-amber-p25'
  return 'text-red-emergency'
}

export function MobileGlanceSheet({ hidden = false }: { hidden?: boolean }) {
  const [detent, setDetent] = useState<Detent>('peek')
  const [filter, setFilter] = useState<StreamFilter>('all')
  const touchStartY = useRef<number | null>(null)

  const { setActiveTab, selectEntity, setFocusIncidentId } = useCivicPick(
    'setActiveTab',
    'selectEntity',
    'setFocusIncidentId',
  )

  const data = useDashboardData()
  const recentCalls = useRecentP25Calls(!hidden && detent !== 'peek')

  if (hidden) return null

  const cycleDetent = () => {
    const idx = DETENTS.indexOf(detent)
    setDetent(DETENTS[(idx + 1) % DETENTS.length])
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current
    touchStartY.current = null
    if (start == null) return
    const end = e.changedTouches[0]?.clientY
    if (end == null) return
    const dy = end - start
    if (Math.abs(dy) < 28) return
    const idx = DETENTS.indexOf(detent)
    if (dy < 0 && idx < DETENTS.length - 1) setDetent(DETENTS[idx + 1])
    if (dy > 0 && idx > 0) setDetent(DETENTS[idx - 1])
  }

  const radioActive = data.radio?.state === 'call' || data.radio?.state === 'encrypted'
  const radioTag = data.radio?.tag || (data.radio?.tgid ? `TG ${data.radio.tgid}` : 'P25')
  const topAdvisory = data.advisories?.items[0] ?? null
  const latestMesh = data.latestMesh[0] ?? null
  const trackSummaryCount = data.notableAir.length + Math.min(data.notableVessels.length, 3)

  const peekLine = radioActive
    ? { tone: 'text-amber-p25', text: `TX ${radioTag}${data.radio?.freq_hz ? ` · ${(data.radio.freq_hz / 1e6).toFixed(3)} MHz` : ''}` }
    : topAdvisory
      ? { tone: topAdvisory.level === 'red' ? 'text-red-emergency' : 'text-amber-gold', text: topAdvisory.title }
      : latestMesh
        ? { tone: 'text-lime-rf', text: `${latestMesh.sender}: ${latestMesh.text}` }
        : { tone: 'text-green-ais', text: 'All clear — swipe up for live streams' }

  const showInc = filter === 'all' || filter === 'incidents'
  const showRadio = filter === 'all' || filter === 'radio'
  const showTracks = filter === 'all' || filter === 'tracks'
  const showMesh = filter === 'all' || filter === 'mesh'

  const sheetHeightClass =
    detent === 'peek'
      ? ''
      : detent === 'half'
        ? 'max-h-[46vh]'
        : 'max-h-[72vh]'

  return (
    <section
      className={`lg:hidden fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 pointer-events-auto bg-onyx-deep/95 backdrop-blur-md border-t border-amber-gold/60 shadow-[0_-8px_28px_rgba(0,0,0,0.65)] flex flex-col transition-all duration-200 ${sheetHeightClass}`}
      aria-label="Quick glance triage panel"
    >
      {/* Grab Handle + Peek Summary Header */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="shrink-0 border-b border-white/10"
      >
        <button
          type="button"
          onClick={cycleDetent}
          aria-expanded={detent !== 'peek'}
          className="w-full text-left px-3 pt-1.5 pb-2 focus:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-gold"
        >
          <div className="w-9 h-0.5 bg-amber-gold/60 mx-auto mb-1.5" aria-hidden="true" />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`font-mono text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 border shrink-0 ${posturePillClass(data.posture)}`}>
                {data.posture}
              </span>
              <span className="font-mono text-[10px] text-on-surface uppercase truncate">
                {data.totalActiveIncidents} INC · {trackSummaryCount} AIR/SEA · {data.latestMesh.length} MESH
              </span>
            </div>
            <span className="font-mono text-[10px] text-amber-gold uppercase tracking-wider shrink-0 flex items-center gap-0.5">
              {detent === 'peek' ? 'Glance' : detent === 'half' ? 'Split' : 'Full'}
              <span className="ms text-[15px] leading-none" aria-hidden="true">
                {detent === 'peek' ? 'expand_less' : 'expand_more'}
              </span>
            </span>
          </div>
          <div className={`font-mono text-[10px] truncate mt-1 ${peekLine.tone}`}>
            {peekLine.text}
          </div>
        </button>
      </div>

      {/* Expanded Content (Half + Full) */}
      {detent !== 'peek' && (
        <>
          {/* Full Detent Only: Condensed Briefing + Weather Strip */}
          {detent === 'full' && (
            <div className="shrink-0 border-b border-white/10 bg-white/2 px-3 py-2 stack-y-2">
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-on-surface">
                  <strong>{data.weather.temp_f != null ? `${Math.round(data.weather.temp_f)}°F` : '—'}</strong>
                  {data.weather.wind_mph != null && (
                    <span className="text-on-surface-variant ml-1.5">
                      {data.weather.wind_dir ? `${data.weather.wind_dir} ` : ''}{Math.round(data.weather.wind_mph)} mph
                    </span>
                  )}
                </span>
                <span className={`font-bold ${aqiTone(data.weather.aqi)}`}>
                  AQI {data.weather.aqi ?? '—'}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('environment')}
                  className="text-[10px] uppercase tracking-wider text-amber-gold"
                >
                  Env →
                </button>
              </div>
              {data.briefingLead && (
                <p className="text-[12px] leading-snug text-on-surface-variant line-clamp-3">
                  <span className="font-mono text-[10px] font-bold uppercase text-amber-gold mr-1">Briefing:</span>
                  {data.briefingLead}
                </p>
              )}
            </div>
          )}

          {/* Filter Chips */}
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-white/10 overflow-x-auto no-scrollbar">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider border shrink-0 transition-colors ${
                  filter === f.id
                    ? 'bg-amber-gold text-onyx-black border-amber-gold'
                    : 'bg-white/3 text-on-surface-variant border-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDetent('peek')}
              className="ml-auto px-2 py-1 font-mono text-[10px] uppercase text-on-surface-variant shrink-0"
              aria-label="Collapse quick glance sheet"
            >
              Hide
            </button>
          </div>

          {/* Scrollable Triage Stream */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/5">
            {/* Active Dispatch + NWS Alerts */}
            {showInc && data.activeDispatch.slice(0, 4).map((inc) => (
              <div
                key={inc.id}
                className={`px-3 py-2 flex items-center gap-2 border-l-2 ${
                  inc.severity >= 5 ? 'border-l-red-emergency bg-red-emergency/8' : 'border-l-amber-gold'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (inc.lon != null && inc.lat != null) {
                      flyMapTo(inc.lon, inc.lat, 13)
                      setDetent('half')
                    } else {
                      setFocusIncidentId(inc.id)
                      setActiveTab('incidents')
                    }
                  }}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-[12px] font-semibold text-on-surface truncate">
                    {inc.nature ?? CATEGORY[inc.category]?.label}
                    {inc.location ? ` · ${inc.location}` : ''}
                  </div>
                  <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                    {[
                      inc.units.slice(0, 3).join(', ') || null,
                      inc.dist_km != null ? `${inc.dist_km.toFixed(1)} km` : null,
                      formatRelativeAge(inc.last_seen, data.nowMs),
                    ].filter(Boolean).join(' · ')}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFocusIncidentId(inc.id)
                    setActiveTab('incidents')
                  }}
                  className="font-mono text-[10px] uppercase text-amber-gold shrink-0 px-1.5 py-1 border border-amber-gold/30"
                >
                  Open
                </button>
              </div>
            ))}

            {showInc && data.weatherAlerts.slice(0, 2).map((alert, idx) => (
              <button
                key={`mob-wx-${idx}`}
                type="button"
                onClick={() => setActiveTab('environment')}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 border-l-2 border-l-amber-gold"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-on-surface truncate">NWS · {alert.event}</div>
                  <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">{alert.headline}</div>
                </div>
                <span className="font-mono text-[10px] uppercase text-amber-gold shrink-0">NWS</span>
              </button>
            ))}

            {/* P25 Radio */}
            {showRadio && radioActive && (
              <div className="px-3 py-2 border-l-2 border-l-amber-p25 bg-amber-p25/10 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-bold text-amber-p25 truncate">
                    LIVE · {radioTag}
                  </div>
                  <div className="font-mono text-[10px] text-on-surface-variant truncate">
                    {data.radio?.freq_hz ? `${(data.radio.freq_hz / 1e6).toFixed(4)} MHz` : 'Receiving transmission'}
                  </div>
                </div>
                <span className="font-mono text-[10px] font-bold text-amber-p25 shrink-0">TX</span>
              </div>
            )}

            {showRadio && recentCalls.slice(0, 3).map((call) => (
              <button
                key={call.id}
                type="button"
                onClick={() => setActiveTab('comms')}
                className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 border-l-2 border-l-amber-p25/60"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-bold text-amber-p25 truncate">
                    {call.tag || `TG ${call.tgid}`}
                  </div>
                  <div className="text-[11px] text-on-surface-variant line-clamp-2 mt-0.5">
                    {call.transcription?.trim() ? `“${call.transcription.trim()}”` : 'Recorded call'}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
                  {formatRelativeAge(call.started_at, data.nowMs)}
                </span>
              </button>
            ))}

            {/* Notable Air & Sea */}
            {showTracks && data.notableAir.slice(0, 3).map((air) => {
              const rm = roleMeta(air.role)
              return (
                <div
                  key={air.id}
                  className="px-3 py-2 flex items-center gap-2 border-l-2 border-l-cyan-adsb"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (air.lon != null && air.lat != null) {
                        flyMapTo(air.lon, air.lat, 11.5)
                        setDetent('half')
                      }
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold text-cyan-adsb truncate">{air.callsign}</span>
                      {(air.alertLabel || air.roleLabel) && (
                        <span className={`font-mono text-[9px] font-bold uppercase px-1 border ${air.alert ? 'text-red-emergency border-red-emergency' : rm ? `${rm.text} ${rm.border}` : 'text-on-surface-variant border-white/20'}`}>
                          {air.alertLabel ?? air.roleLabel}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                      {[
                        air.altFt != null ? `${air.altFt.toLocaleString()} ft` : null,
                        air.speedKt != null ? `${air.speedKt} kt` : null,
                        air.distKm != null ? `${air.distKm.toFixed(1)} km` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => selectEntity(air.id)}
                    className="font-mono text-[10px] uppercase text-cyan-adsb shrink-0 px-1.5 py-1 border border-cyan-adsb/30"
                  >
                    Info
                  </button>
                </div>
              )
            })}

            {showTracks && data.notableVessels.slice(0, 3).map((v) => (
              <div
                key={v.id}
                className="px-3 py-2 flex items-center gap-2 border-l-2 border-l-green-ais"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (v.lon != null && v.lat != null) {
                      flyMapTo(v.lon, v.lat, 12)
                      setDetent('half')
                    }
                  }}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-mono text-[11px] font-bold text-green-ais truncate">{v.name}</div>
                  <div className="font-mono text-[10px] text-on-surface-variant truncate mt-0.5">
                    {[
                      v.shipType ?? (v.underway ? 'Underway' : 'Vessel'),
                      v.speedKt != null ? `${v.speedKt} kt` : null,
                      v.distKm != null ? `${v.distKm.toFixed(1)} km` : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => selectEntity(v.id)}
                  className="font-mono text-[10px] uppercase text-green-ais shrink-0 px-1.5 py-1 border border-green-ais/30"
                >
                  Info
                </button>
              </div>
            ))}

            {/* MeshCore Feed */}
            {showMesh && data.latestMesh.slice(0, 4).map((msg) => (
              <button
                key={msg.key}
                type="button"
                onClick={() => setActiveTab('comms')}
                className="w-full text-left px-3 py-2 flex items-start justify-between gap-2 border-l-2 border-l-lime-rf"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-bold text-lime-rf truncate">
                    {msg.sender} <span className="text-on-surface-variant font-normal">· #{msg.channel}</span>
                  </div>
                  <div className="text-[11px] text-on-surface-variant line-clamp-2 mt-0.5">{msg.text}</div>
                </div>
                <span className="font-mono text-[10px] text-on-surface-variant shrink-0">
                  {formatRelativeAge(msg.timestamp, data.nowMs)}
                </span>
              </button>
            ))}

            {/* Empty state when filtered category has no items */}
            {((filter === 'incidents' && data.activeDispatch.length === 0 && data.weatherAlerts.length === 0) ||
              (filter === 'radio' && !radioActive && recentCalls.length === 0) ||
              (filter === 'tracks' && data.notableAir.length === 0 && data.notableVessels.length === 0) ||
              (filter === 'mesh' && data.latestMesh.length === 0)) && (
              <div className="px-3 py-4 font-mono text-[11px] text-on-surface-variant text-center">
                No active items in this stream right now.
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
