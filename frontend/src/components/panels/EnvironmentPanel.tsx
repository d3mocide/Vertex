import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore, WeatherAlert, SystemEvent, Entity } from '../../store'
import { RADAR_LAYER, MAP_STYLE, DEFAULT_CENTER, API_BASE } from '../../config'
import { RadarLayer } from '../layers/RadarLayer'
import { authHeaders, clearToken } from '../../auth'

type FireRelevance = 'local' | 'regional'

type FirePanelEntity = {
  entity_id: string
  display_name: string
  distanceKm: number | null
  relevance: FireRelevance
  link?: string
  eventTs?: string
}

function firePanelEntityFromEntity(entity: Entity): FirePanelEntity | null {
  if (entity.entity_type !== 'fire_incident') return null

  const relevance = entity.identity?.relevance
  if (relevance !== 'local' && relevance !== 'regional') return null

  const distanceRaw = entity.identity?.distance_km ?? entity.distance_km
  const eventTs = typeof entity.identity?.event_ts === 'string'
    ? entity.identity.event_ts
    : typeof entity.last_seen === 'string'
      ? entity.last_seen
      : undefined

  return {
    entity_id: entity.entity_id,
    display_name: entity.display_name || 'Wildfire',
    distanceKm: typeof distanceRaw === 'number' ? distanceRaw : null,
    relevance,
    link: typeof entity.identity?.link === 'string' ? entity.identity.link : undefined,
    eventTs,
  }
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'OPEN INCIDENT'
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'OPEN INCIDENT'

  const deltaMs = Date.now() - ts
  const hours = Math.max(0, Math.floor(deltaMs / 3_600_000))
  if (hours < 1) return 'UPDATED <1H AGO'
  if (hours < 24) return `UPDATED ${hours}H AGO`
  const days = Math.floor(hours / 24)
  return `UPDATED ${days}D AGO`
}

function FireStatusCard({
  localFires,
  regionalFires,
  aqi,
  aqiLabel,
}: {
  localFires: FirePanelEntity[]
  regionalFires: FirePanelEntity[]
  aqi: number | undefined
  aqiLabel: string | undefined
}) {
  const smokeRisk =
    aqi == null ? 'AQI TELEMETRY LIMITED' :
    aqi <= 50 ? 'LOW LOCAL SMOKE IMPACT' :
    aqi <= 100 ? 'WATCH FOR DRIFTING SMOKE' :
    'SMOKE IMPACT POSSIBLE'

  const smokeTone =
    aqi == null ? 'text-on-surface-variant' :
    aqi <= 50 ? 'text-green-ais' :
    aqi <= 100 ? 'text-amber-gold' :
    'text-red-500'

  const renderFireRow = (fire: FirePanelEntity) => (
    <article key={fire.entity_id} className="border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-on-surface truncate">{fire.display_name}</div>
          <div className="mt-1 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
            {fire.distanceKm != null ? `${Math.round(fire.distanceKm)} KM · ` : ''}{formatRelativeTime(fire.eventTs)}
          </div>
        </div>
        <span className={`font-mono text-[8px] font-bold uppercase tracking-widest ${fire.relevance === 'local' ? 'text-red-500' : 'text-amber-gold'}`}>
          {fire.relevance === 'local' ? 'ALERT' : 'WATCH'}
        </span>
      </div>
      {fire.link && (
        <a
          href={fire.link}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex text-[8px] font-mono uppercase tracking-widest text-amber-gold hover:text-amber-200"
        >
          SOURCE
        </a>
      )}
    </article>
  )

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">local_fire_department</span>
        FIRE / SMOKE STATUS
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="border border-red-500/20 bg-red-500/5 px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Alert Radius</div>
          <div className="mt-1 text-[20px] font-black text-on-surface">{localFires.length}</div>
          <div className="font-mono text-[8px] text-red-400 uppercase tracking-widest">Local fires</div>
        </div>
        <div className="border border-amber-gold/20 bg-amber-gold/5 px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Regional Watch</div>
          <div className="mt-1 text-[20px] font-black text-on-surface">{regionalFires.length}</div>
          <div className="font-mono text-[8px] text-amber-gold uppercase tracking-widest">Potential sources</div>
        </div>
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <div className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Smoke Signal</div>
          <div className={`mt-1 text-[10px] font-black uppercase tracking-wider ${smokeTone}`}>{smokeRisk}</div>
          <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
            {aqi != null ? `AQI ${aqi}${aqiLabel ? ` · ${aqiLabel}` : ''}` : 'Use smoke overlay + AQI'}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section aria-labelledby="fire-local-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="fire-local-heading" className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Local Alert Queue</h3>
            <span className="font-mono text-[8px] text-red-400 uppercase tracking-widest">Actionable near region</span>
          </div>
          {localFires.length === 0 ? (
            <div className="border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
              No current fires inside the local alert radius.
            </div>
          ) : (
            <div className="space-y-1.5">
              {localFires.slice(0, 3).map(renderFireRow)}
            </div>
          )}
        </section>

        <section aria-labelledby="fire-regional-heading">
          <div className="mb-2 flex items-center justify-between">
            <h3 id="fire-regional-heading" className="text-[9px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Regional Smoke Watch</h3>
            <span className="font-mono text-[8px] text-amber-gold uppercase tracking-widest">Use for drift awareness</span>
          </div>
          {regionalFires.length === 0 ? (
            <div className="border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">
              No regional wildfire sources currently inside the watch area.
            </div>
          ) : (
            <div className="space-y-1.5">
              {regionalFires.slice(0, 4).map(renderFireRow)}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function magnitudeFromEvent(event: SystemEvent): number | null {
  const raw = event.details?.magnitude
  return typeof raw === 'number' ? raw : null
}

function SeismicCard({ events }: { events: SystemEvent[] }) {
  const strongest = events.reduce<number | null>((acc, ev) => {
    const mag = magnitudeFromEvent(ev)
    if (mag == null) return acc
    if (acc == null) return mag
    return Math.max(acc, mag)
  }, null)

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden">
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">earthquake</span>
        SEISMIC FEED
      </div>

      <div className="flex items-end justify-between mb-3">
        <div className="flex flex-col">
          <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Last 24 Hours</span>
          <span className="text-[18px] font-black text-on-surface tracking-tight">{events.length} event{events.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Strongest</span>
          <span className="font-mono text-[12px] text-amber-gold font-bold">
            {strongest != null ? `M${strongest.toFixed(1)}` : 'N/A'}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
            No recorded earthquakes in range
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {events.slice(0, 4).map((ev) => {
            const mag = magnitudeFromEvent(ev)
            const place = typeof ev.details?.place === 'string' ? ev.details.place : ev.summary
            return (
              <div key={ev.event_id} className="border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-bold text-on-surface truncate">{place}</span>
                  <span className="font-mono text-[9px] text-amber-gold shrink-0">{mag != null ? `M${mag.toFixed(1)}` : ev.severity.toUpperCase()}</span>
                </div>
                <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest mt-1">
                  {new Date(ev.ts).toLocaleString()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AqiGauge({ aqi }: { aqi: number | undefined }) {
  if (aqi == null) return null
  const pct = Math.min(aqi / 300, 1) * 100
  const color =
    aqi <= 50  ? '#00C853' :
    aqi <= 100 ? '#FFB800' :
    aqi <= 150 ? '#FF8F00' : '#C62828'

  const label =
    aqi <= 50  ? 'Good' :
    aqi <= 100 ? 'Moderate' :
    aqi <= 150 ? 'Unhealthy (Sensitive)' : 'Unhealthy'

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative overflow-hidden group">
      {/* Decorative background glow */}
      <div 
        className="absolute -right-8 -top-8 w-24 h-24 blur-[40px] opacity-15 pointer-events-none transition-colors duration-1000"
        style={{ backgroundColor: color }}
      />
      
      <div className="label-caps mb-3 flex items-center gap-2">
        <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">air</span>
        AIR QUALITY
      </div>
      
      <div className="flex items-center gap-5 mb-4">
        <span className="font-mono text-5xl font-black tracking-tighter drop-shadow-sm leading-none" style={{ color }}>
          {aqi}
        </span>
        <div className="flex flex-col">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
          <span className="text-[8px] text-on-surface-variant uppercase tracking-tighter">Current EPA Rating</span>
        </div>
      </div>

      {/* Multi-segment Scale Background */}
      <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="h-full w-[16.6%] bg-green-500/20" />
          <div className="h-full w-[16.6%] bg-yellow-500/20" />
          <div className="h-full w-[16.6%] bg-orange-500/20" />
          <div className="h-full w-[16.6%] bg-red-500/20" />
          <div className="h-full w-[16.6%] bg-purple-500/20" />
          <div className="h-full w-[16.6%] bg-red-900/20" />
        </div>
        
        {/* Actual Progress Bar */}
        <div
          className="absolute left-0 top-0 bottom-0 transition-all duration-1000 ease-out rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      <div className="flex justify-between mt-2 font-mono text-[7px] text-on-surface-variant/50 uppercase tracking-tighter">
        <span>0 Good</span>
        <span>100 Mod</span>
        <span>200 Unhealthy</span>
        <span>300+</span>
      </div>
    </div>
  )
}

function WeatherAlertCard({ alert }: { alert: WeatherAlert }) {
  const isSevere = /warning|emergency|critical/i.test(alert.event)
  
  return (
    <div className={`hud-panel p-4 bg-onyx-deep/60 relative overflow-hidden transition-all duration-500 ${isSevere ? 'border-l-2 border-l-red-600' : 'border-l-2 border-l-amber-gold'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex flex-col">
          <span className={`text-[10px] font-black uppercase tracking-widest ${isSevere ? 'text-red-500' : 'text-amber-gold'}`}>
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
          <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest">Expires</span>
          <span className="text-[10px] font-mono text-on-surface uppercase font-bold">{new Date(alert.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {isSevere && (
        <div className="absolute inset-0 bg-red-600/5 pointer-events-none" />
      )}
    </div>
  )
}

function WeatherCard() {
  const weather = useCivicStore((s) => s.weather)

  const stats = [
    { label: 'Temperature', value: weather.temp_f != null ? `${Math.round(weather.temp_f)}°F` : '--', icon: 'thermostat' },
    { label: 'Condition', value: weather.condition?.toUpperCase() || 'N/A', icon: 'cloud' },
    { label: 'Wind Speed', value: weather.wind_mph != null ? `${Math.round(weather.wind_mph)} MPH` : '--', icon: 'air', sub: weather.wind_dir },
    { label: 'Humidity', value: weather.humidity != null ? `${Math.round(weather.humidity)}%` : '--', icon: 'opacity' },
  ]

  return (
    <div className="hud-panel p-4 bg-onyx-deep/40 relative">
      <div className="label-caps mb-4 flex items-center gap-2">
        <span className="ms text-[12px] leading-none text-amber-gold" aria-hidden="true">device_thermostat</span>
        CURRENT CONDITIONS
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-sm bg-white/[0.03] flex items-center justify-center border border-white/5 group-hover:border-amber-gold/30 transition-colors">
              <span className="ms text-on-surface-variant group-hover:text-amber-gold transition-colors text-[16px]" aria-hidden="true">{s.icon}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-widest mb-0.5">{s.label}</span>
              <div className="flex items-baseline gap-2 leading-none">
                <span className="text-[16px] font-black text-on-surface tracking-tight">{s.value}</span>
                {s.sub && (
                  <span className="text-[9px] font-mono text-amber-gold font-bold">{s.sub}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-3 border-t border-white/5 flex items-center justify-between">
         <span className="text-[7px] font-mono text-on-surface-variant/60 uppercase tracking-widest">
            Weather Service: NOAA/NWS
          </span>
         <div className="flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-green-ais animate-pulse" />
            <span className="text-[7px] font-mono text-on-surface-variant/60 uppercase">Data Live</span>
         </div>
      </div>
    </div>
  )
}

function RadarMiniMap({ isFullHeight }: { isFullHeight?: boolean }) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return

    const m = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: 6.5,
      interactive: false,
      attributionControl: false,
    })

    m.on('load', () => {
      const canvas = m.getCanvas()
      // Keep full colour — the NWS green/yellow/red palette is the key visual signal.
      // Slight brightness reduction keeps it readable against the dark panel background.
      canvas.style.filter = 'brightness(0.85) contrast(1.1)'
      setMap(m)
    })

    return () => {
      m.remove()
    }
  }, [])

  return (
    <div
      className={`relative w-full ${isFullHeight ? 'flex-1 min-h-0' : 'h-[420px]'} bg-onyx-deep/60 rounded-sm overflow-hidden mb-4 border border-white/5`}
      style={{
        // Fade the circular NEXRAD scan boundary so the hard edge disappears.
        // The radar tile layer is a radial scan — without this mask you see the
        // exact circle where the data ends against the dark map background.
        maskImage: 'radial-gradient(ellipse 88% 88% at 50% 50%, black 45%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 88% 88% at 50% 50%, black 45%, transparent 100%)',
      }}
    >
      <div ref={mapContainerRef} className="absolute inset-0" />
      {map && <RadarLayer map={map} />}
      
      {/* Tactical Overlays */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-t from-onyx-black/40 to-transparent" />
        {/* Crosshair Center */}
        <div className="absolute inset-0 flex items-center justify-center opacity-20">
          <div className="w-4 h-px bg-amber-gold" />
          <div className="h-4 w-px bg-amber-gold" />
        </div>
        {/* Radar Sweep Effect (Purely Visual) */}
        <div 
          className="absolute inset-0 animate-spin-slow opacity-20"
          style={{ 
            background: 'conic-gradient(from 0deg, rgba(255, 184, 0, 0.15) 0deg, transparent 90deg)' 
          }} 
        />
      </div>
    </div>
  )
}

function RadarControls({ isFullHeight }: { isFullHeight?: boolean }) {
  const radarOpacity  = useCivicStore((s) => s.radarOpacity)
  const setRadarOpacity = useCivicStore((s) => s.setRadarOpacity)

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setRadarOpacity(Number(e.target.value)),
    [setRadarOpacity],
  )

  return (
    <div className={`hud-panel p-4 bg-onyx-deep/40 flex flex-col ${isFullHeight ? 'h-full' : ''}`}>
      <RadarMiniMap isFullHeight={isFullHeight} />

      <div className="transition-all duration-300">
        <div className="flex items-center justify-between mb-2">
          <span className="label-caps text-[9px] text-on-surface-variant">SCAN OPACITY</span>
          <span className="font-mono text-[10px] text-amber-gold font-bold">
            {Math.round(radarOpacity * 100)}%
          </span>
        </div>
        <div className="relative flex items-center h-4">
           <input
             type="range"
             min={0.1}
             max={1}
             step={0.05}
             value={radarOpacity}
             onChange={handleOpacity}
             className="w-full accent-amber-gold bg-white/5 h-1 rounded-full appearance-none cursor-pointer"
             aria-label="Radar opacity"
           />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between font-mono text-[8px] text-on-surface-variant/60 uppercase tracking-widest">
          <span>{RADAR_LAYER.replace(/-0$/, '')} · IEM NEXRAD</span>
          <span>5 MIN REFRESH</span>
      </div>
    </div>
  )
}

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
    // Auto-enable radar when entering environment monitor
    setRadarVisible(true)
    return () => setRadarVisible(false)
  }, [setRadarVisible])

  useEffect(() => {
    let cancelled = false

    const loadSeismic = async () => {
      try {
        const res = await fetch(`${API_BASE}/events?hours=24`, { headers: authHeaders() })
        if (res.status === 401) {
          clearToken()
          window.location.reload()
          return
        }
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
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex flex-col h-full bg-onyx-black/95 backdrop-blur-sm z-10">
      {/* Header Info Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-onyx-black/40">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Region Center</span>
            <span className="text-[10px] font-mono text-on-surface font-bold uppercase tracking-widest">Tualatin, OR · 45.38°N 122.76°W</span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex flex-col">
            <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-[0.2em]">Last Update</span>
            <span className="text-[10px] font-mono text-on-surface font-bold uppercase tracking-widest">
              DATA LIVE
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500/40" /> NWS</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500/40" /> EPA</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-500/40" /> LOCAL SENSORS</span>
        </div>
      </div>

      {/* Scrollable body — overflow lives here so both columns size to content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex flex-col lg:flex-row gap-10 p-6 items-start">

          {/* LEFT COLUMN: Data Stream */}
          <div className="flex-1 min-w-0 flex flex-col gap-8 pr-1">
            {/* NWS Alerts */}
            <section aria-labelledby="nws-heading">
              {weather.alerts.length === 0 ? (
                <div className="hud-panel p-8 flex flex-col items-center justify-center gap-4 bg-onyx-deep/40 border-dashed border-white/5">
                  <div className="relative">
                    <div className="absolute inset-0 bg-green-ais/20 blur-xl rounded-full animate-pulse" />
                    <span
                      className="ms text-[48px] text-green-ais relative"
                      aria-hidden="true"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      verified_user
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <p className="font-mono text-[12px] text-on-surface font-bold uppercase tracking-[0.2em]">
                      Systems Nominal
                    </p>
                    <p className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest mt-1">
                      No active weather advisories for this region
                    </p>
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
                      className={`
                        relative p-4 border rounded-sm flex flex-col items-center gap-2 text-center transition-all duration-500
                        ${h.active
                          ? 'border-amber-gold/30 bg-amber-gold/5 shadow-[0_0_15px_rgba(255,184,0,0.1)]'
                          : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'}
                      `}
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
                        <span className={`text-[10px] font-black uppercase tracking-tight ${h.active ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
                          {h.label}
                        </span>
                        <span className={`font-mono text-[8px] font-bold mt-0.5 tracking-widest ${h.active ? 'text-amber-gold' : 'text-on-surface-variant/30'}`}>
                          {h.active ? 'WATCH ACTIVE' : 'SECURE'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Air Quality */}
            <AqiGauge aqi={weather.aqi} />

            <FireStatusCard
              localFires={localFires}
              regionalFires={regionalFires}
              aqi={weather.aqi}
              aqiLabel={weather.aqi_label}
            />

            {/* Current Conditions */}
            <WeatherCard />

          </div>

          {/* RIGHT COLUMN: Radar — self-start so it doesn't stretch past left column content */}
          <div className="flex-1 min-w-0 flex flex-col self-start gap-6">
            <RadarControls />
            <SeismicCard events={mergedSeismicEvents} />
          </div>

        </div>
      </div>
    </div>
  )
}
