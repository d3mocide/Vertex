import { useEffect, useRef, useState } from 'react'
import { useCivicPick } from '../../store'
import type { SummaryPosture } from '../../storeTypes'
import { regionInfo } from '../../config'
import { flyMapTo, useMapSlot } from '../mapViewport'
import {
  formatRelativeAge,
  useDashboardData,
  useNearestMetar,
  useRecentP25Calls,
} from './dashboard/useDashboardData'
import { useDashboardHistory, useForecast } from './dashboard/feeds'
import { GlassCard } from './dashboard/ui'
import { BriefingView, ForecastView, KpiTile, SituationCounts, SituationList } from './dashboard/sections'

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

  const { setWallMode, radarVisible, setRadarVisible } = useCivicPick(
    'setWallMode',
    'radarVisible',
    'setRadarVisible',
  )

  const data = useDashboardData()
  const recentCalls = useRecentP25Calls(true)
  const metar = useNearestMetar(true)
  const history = useDashboardHistory()
  const forecast = useForecast()

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

  const s = history?.series
  const t = history?.totals
  const callsThisHour = s ? s.radio_call[s.radio_call.length - 1] ?? null : null
  const life = data.situation.filter((i) => i.tone === 'red').length
  const regionLabel = regionInfo.name ? `${regionInfo.name.toUpperCase()} SECTOR` : 'SITUATIONAL AWARENESS'

  return (
    <div
      className="fixed inset-0 z-10 pointer-events-none flex flex-col overflow-hidden"
      role="region"
      aria-label="Wall display mode"
    >
      {/* Top Telemetry Bar */}
      <header className="relative pointer-events-auto shrink-0 bg-white/3 backdrop-blur-md border-b border-white/6 shadow-[0_4px_30px_rgba(0,0,0,0.5)] px-4 py-2.5 flex items-center justify-between gap-4">
        <div
          className="absolute left-0 right-0 -bottom-px h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, #FFB800 20%, #FFB800 80%, transparent)', opacity: 0.35 }}
          aria-hidden="true"
        />
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
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 p-3 pointer-events-none">
        {/* LEFT: live map, the day in numbers, and the radio */}
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
                    : 'bg-onyx-black/70 border-white/20 text-on-surface-variant'
                }`}
              >
                LIVE MAP · RADAR {radarVisible ? 'ON' : 'OFF'}
              </button>
              <div className="pointer-events-auto px-2.5 py-1 bg-onyx-black/70 border border-white/20 backdrop-blur-md font-mono text-[11px] tracking-wider flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${data.connected ? 'bg-green-ais animate-pulse' : 'bg-red-emergency'}`}
                  aria-hidden="true"
                />
                <span className={data.connected ? 'text-green-ais' : 'text-red-emergency'}>{data.connected ? 'LIVE' : 'OFFLINE'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-3 shrink-0 pointer-events-none">
            <KpiTile size="wall" icon="flight" label="Aircraft" colorClass="text-cyan-adsb" now={data.totalAircraft} total={t?.aircraft} series={s?.aircraft} />
            <KpiTile size="wall" icon="sailing" label="Vessels" colorClass="text-green-ais" now={data.totalVessels} total={t?.vessel} series={s?.vessel} />
            <KpiTile size="wall" icon="cell_tower" label="Radio calls" colorClass="text-amber-p25" now={callsThisHour ?? '—'} nowLabel="this hr" total={t?.radio_call} series={s?.radio_call} />
            <KpiTile
              size="wall" icon="emergency" label="Dispatch" colorClass={life > 0 ? 'text-red-emergency' : 'text-amber-gold'}
              now={data.activeDispatch.length} nowLabel="active" total={t?.dispatch_incident} series={s?.dispatch_incident}
            />
            <KpiTile size="wall" icon="hub" label="Mesh" colorClass="text-lime-rf" now={data.meshNodeCount} nowLabel="nodes" total={t?.mesh_node} totalLabel="24H" series={s?.mesh_node} />
          </div>

          {/* High-contrast P25 transcript banner */}
          <section
            className={`pointer-events-auto shrink-0 border backdrop-blur-md p-3.5 ${
              radioActive ? 'border-amber-p25 bg-amber-p25/12' : 'border-white/10 bg-onyx-black/55'
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

        {/* RIGHT: briefing, the situation board and the forecast */}
        <div className="flex flex-col gap-3 min-h-0 pointer-events-none">
          <GlassCard
            icon="psychology"
            title="AI Briefing"
            tone={data.posture === 'HIGH' ? 'red' : data.posture === 'ELEVATED' ? 'amber' : undefined}
            className="shrink-0 max-h-[34%]"
            bodyClass="overflow-hidden"
            right={data.summary.ts ? <span className="font-mono text-[11px] text-on-surface-variant">{formatRelativeAge(data.summary.ts, data.nowMs)} AGO</span> : null}
          >
            <BriefingView digest={data.briefing} ts={null} nowMs={data.nowMs} size="wall" maxPoints={2} />
          </GlassCard>

          <GlassCard
            icon="report"
            title="Situation"
            tone={life > 0 ? 'red' : data.situation.length > 0 ? 'amber' : undefined}
            className="flex-1 min-h-[140px]"
            bodyClass="overflow-hidden"
            right={<SituationCounts items={data.situation} />}
          >
            <SituationList
              items={data.situation}
              nowMs={data.nowMs}
              size="wall"
              limit={8}
              onSelect={(it) => {
                if (it.lon != null && it.lat != null) flyMapTo(it.lon, it.lat, 13)
              }}
            />
          </GlassCard>

          <GlassCard icon="partly_cloudy_day" title="Next Hours" className="shrink-0">
            <ForecastView forecast={forecast} size="wall" hours={10} />
          </GlassCard>
        </div>
      </div>
    </div>
  )
}
