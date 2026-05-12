import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore, Entity } from '../../store'
import { API_BASE, MAP_STYLE, DEFAULT_CENTER } from '../../config'

// ─── Constants ────────────────────────────────────────────────────────────────
const TIME_WINDOWS = [
  { label: '1H',  minutes: 60   },
  { label: '6H',  minutes: 360  },
  { label: '12H', minutes: 720  },
  { label: '24H', minutes: 1440 },
  { label: '72H', minutes: 4320 },
] as const

// ─── Types ────────────────────────────────────────────────────────────────────
interface ObsPoint {
  ts:       string
  lat:      number
  lon:      number
  altitude: number | null
  heading:  number | null
  speed:    number | null
}

interface ReplayEntity {
  entity_id:    string
  display_name: string
  points:       ObsPoint[]
}

interface FlightStats {
  maxAltFt:    number | null
  minAltFt:    number | null
  maxSpeedKts: number | null
  avgSpeedKts: number | null
  durationMin: number
  firstSeen:   string
  lastSeen:    string
  pointCount:  number
}

interface FlightEntry {
  entityId:    string
  displayName: string
  firstSeen:   string
  lastSeen:    string
  liveEntity:  Entity | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtAlt(ft: number | null | undefined): string {
  if (ft == null) return '--'
  return `${Math.round(ft).toLocaleString()} ft`
}

function fmtSpd(kts: number | null | undefined): string {
  if (kts == null) return '--'
  return `${Math.round(kts)} kts`
}

function fmtTime(iso: string): string {
  if (!iso) return '--'
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '--' }
}

function fmtDateTime(iso: string): string {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return '--' }
}

function computeStats(points: ObsPoint[]): FlightStats | null {
  if (!points.length) return null
  const alts  = points.map(p => p.altitude).filter((a): a is number => a != null)
  const spds  = points.map(p => p.speed).filter((s): s is number => s != null)
  const times = points.map(p => Date.parse(p.ts)).filter(t => !isNaN(t)).sort((a, b) => a - b)
  const durationMin = times.length >= 2
    ? Math.round((times[times.length - 1] - times[0]) / 60_000)
    : 0
  return {
    maxAltFt:    alts.length ? Math.max(...alts)                                              : null,
    minAltFt:    alts.length ? Math.min(...alts)                                              : null,
    maxSpeedKts: spds.length ? Math.max(...spds)                                              : null,
    avgSpeedKts: spds.length ? Math.round(spds.reduce((a, b) => a + b, 0) / spds.length)     : null,
    durationMin,
    firstSeen:  points[0]?.ts ?? '',
    lastSeen:   points[points.length - 1]?.ts ?? '',
    pointCount: points.length,
  }
}

function getIdent(entity: Entity | null, field: string): string {
  if (!entity?.identity) return '--'
  const v = entity.identity[field]
  return v != null ? String(v) : '--'
}

function nestedStr(entity: Entity | null, outerKey: string, innerKey: string): string {
  const outer = entity?.identity?.[outerKey]
  if (outer == null || typeof outer !== 'object') return ''
  const inner = (outer as Record<string, unknown>)[innerKey]
  return typeof inner === 'string' ? inner : ''
}

function phaseLabel(phase: string | null | undefined): { text: string; cls: string } {
  switch (phase) {
    case 'climb':    return { text: 'CLB ↑', cls: 'text-green-ais'          }
    case 'descent':  return { text: 'DSC ↓', cls: 'text-amber-gold'         }
    case 'cruise':   return { text: 'CRZ →', cls: 'text-cyan-adsb'          }
    case 'taxi':     return { text: 'GND',   cls: 'text-on-surface-variant'  }
    case 'approach': return { text: 'APP ↓', cls: 'text-amber-p25'          }
    default:         return { text: '---',   cls: 'text-on-surface-variant'  }
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCard({ label, value, unit, colorClass }: {
  label: string; value: string; unit: string; colorClass: string
}) {
  return (
    <div className="p-2.5 border border-white/10 bg-white/5 rounded-sm">
      <div className="font-mono text-[7px] text-on-surface-variant uppercase tracking-widest mb-1">{label}</div>
      <div className={`font-black text-sm ${colorClass} leading-none`}>{value}</div>
      <div className="font-mono text-[7px] text-on-surface-variant/60 uppercase mt-0.5">{unit}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest shrink-0">{label}</span>
      <span className="font-mono text-[9px] text-on-surface truncate text-right">{value}</span>
    </div>
  )
}

function LiveStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[7px] text-on-surface-variant/60 uppercase tracking-wider leading-none mb-0.5">{label}</div>
      <div className="font-mono text-[10px] font-bold text-on-surface leading-tight">{value}</div>
    </div>
  )
}

function AircraftRow({
  entityId, displayName, liveEntity, isSelected, lastSeen, onClick,
}: {
  entityId:    string
  displayName: string
  liveEntity:  Entity | null
  isSelected:  boolean
  lastSeen:    string
  onClick:     () => void
}) {
  const callsign = getIdent(liveEntity, 'callsign') !== '--'
    ? getIdent(liveEntity, 'callsign')
    : (displayName || entityId.split(':').pop()?.toUpperCase() || '--')
  const icaoType = getIdent(liveEntity, 'icao_type')
  const rawPhase = getIdent(liveEntity, 'phase')
  const phase    = rawPhase !== '--' ? rawPhase : null
  const badge    = phaseLabel(phase)
  const altFt    = liveEntity?.altitude ?? null
  const spdKts   = liveEntity?.speed    ?? null
  const isLive   = liveEntity != null

  return (
    <button
      type="button"
      className={`
        w-full flex items-center justify-between px-3 py-2 border-b border-white/5 transition-colors text-left group
        ${isSelected
          ? 'bg-cyan-adsb/10 border-l-2 border-l-cyan-adsb'
          : 'hover:bg-white/5 border-l-2 border-l-transparent'}
      `}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`ms text-[13px] transition-colors shrink-0
            ${isSelected ? 'text-cyan-adsb' : isLive ? 'text-cyan-adsb/70 group-hover:text-cyan-adsb' : 'text-on-surface-variant/40 group-hover:text-on-surface-variant/70'}`}
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          flight
        </span>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-bold truncate transition-colors ${isSelected ? 'text-cyan-adsb' : 'text-on-surface group-hover:text-amber-gold'}`}>
              {callsign}
            </span>
            {isLive && <span className="w-1 h-1 rounded-full bg-green-ais shrink-0" title="Live" />}
          </div>
          <span className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest truncate">
            {icaoType !== '--' ? icaoType : entityId.split(':').pop()?.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
        {isLive ? (
          <>
            <span className={`font-mono text-[8px] font-bold ${badge.cls}`}>{badge.text}</span>
            <span className="font-mono text-[8px] text-on-surface-variant">
              {altFt != null ? `${(Math.round(altFt / 100) * 100).toLocaleString()}ft` : '--'}
            </span>
            <span className="font-mono text-[8px] text-on-surface-variant">
              {spdKts != null ? `${Math.round(spdKts)}kts` : '--'}
            </span>
          </>
        ) : (
          <>
            <span className="font-mono text-[8px] text-on-surface-variant/60">{fmtTime(lastSeen)}</span>
            <span className="font-mono text-[7px] text-on-surface-variant/40 uppercase">last seen</span>
          </>
        )}
      </div>
    </button>
  )
}

// ─── Flight Mini Map ──────────────────────────────────────────────────────────
function FlightMiniMap({ trailPoints, entity }: {
  trailPoints: ObsPoint[]
  entity:      Entity | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  // Initialise the map once
  useEffect(() => {
    if (!containerRef.current) return
    const m = new maplibregl.Map({
      container:        containerRef.current,
      style:            MAP_STYLE,
      center:           DEFAULT_CENTER,
      zoom:             7,
      interactive:      false,
      attributionControl: false,
    })

    m.on('load', () => {
      m.getCanvas().style.filter = 'brightness(0.75) contrast(1.05)'

      // Trail
      m.addSource('fl-trail', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id:     'fl-trail-line',
        type:   'line',
        source: 'fl-trail',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint:  { 'line-color': '#00E5FF', 'line-width': 2.5, 'line-opacity': 0.85 },
      })

      // Current position — outer glow + inner dot
      m.addSource('fl-pos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      m.addLayer({
        id: 'fl-pos-glow', type: 'circle', source: 'fl-pos',
        paint: { 'circle-radius': 9, 'circle-color': '#00E5FF', 'circle-opacity': 0.18 },
      })
      m.addLayer({
        id: 'fl-pos-dot', type: 'circle', source: 'fl-pos',
        paint: {
          'circle-radius': 4,
          'circle-color': '#00E5FF',
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 1.5,
        },
      })

      mapRef.current = m
      setReady(true)
    })

    return () => {
      mapRef.current = null
      setReady(false)
      m.remove()
    }
  }, [])

  // Update trail whenever points change
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    const pts = trailPoints.filter(p => p.lat != null && p.lon != null)
    const coords = pts.map(p => [p.lon, p.lat] as [number, number])

    ;(m.getSource('fl-trail') as maplibregl.GeoJSONSource).setData({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    })

    if (coords.length >= 2) {
      const lons = coords.map(c => c[0])
      const lats = coords.map(c => c[1])
      m.fitBounds(
        [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
        { padding: 36, maxZoom: 11, animate: false },
      )
    }
  }, [ready, trailPoints])

  // Update live position dot
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    const hasPos = entity?.lat != null && entity?.lon != null
    ;(m.getSource('fl-pos') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: hasPos
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [entity!.lon!, entity!.lat!] } }]
        : [],
    })
    // If no trail yet, centre on live position
    if (trailPoints.length < 2 && hasPos) {
      m.setCenter([entity!.lon!, entity!.lat!])
      m.setZoom(9)
    }
  }, [ready, entity, trailPoints.length])

  const isEmpty = trailPoints.length === 0 && !entity

  return (
    <div className="relative w-full h-48 bg-onyx-deep/60 rounded-sm overflow-hidden border border-white/5 shadow-inner">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Bottom vignette */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-onyx-black/50 to-transparent" />

      {/* Track point counter */}
      {!isEmpty && (
        <div className="absolute bottom-2 left-2 pointer-events-none">
          <span className="font-mono text-[7px] text-on-surface-variant/60 uppercase tracking-widest bg-onyx-black/60 px-1.5 py-0.5 rounded-sm">
            {trailPoints.length > 0 ? `${trailPoints.length} pts` : 'live position'}
          </span>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-on-surface-variant/20 pointer-events-none">
          <span className="ms text-3xl">flight_takeoff</span>
          <span className="text-[8px] font-mono uppercase tracking-widest">Select aircraft for trail</span>
        </div>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function FlightLogPanel() {
  const { entities, selectedEntityId, selectEntity } = useCivicStore()

  const [timeWindow,     setTimeWindow]     = useState(60)
  const [search,         setSearch]         = useState('')
  const [replayFlights,  setReplayFlights]  = useState<Record<string, ReplayEntity>>({})
  const [loadingReplay,  setLoadingReplay]  = useState(false)
  const [trailPoints,    setTrailPoints]    = useState<ObsPoint[]>([])
  const [loadingTrail,   setLoadingTrail]   = useState(false)
  const [detailEntity,   setDetailEntity]   = useState<Entity | null>(null)

  const lastFetchedDetailId = useRef<string | null>(null)

  // ── Fetch historical aircraft list for the time window ─────────────────────
  const fetchReplay = useCallback(async (minutes: number) => {
    setLoadingReplay(true)
    try {
      const end   = new Date().toISOString()
      const start = new Date(Date.now() - minutes * 60_000).toISOString()
      const res   = await fetch(
        `${API_BASE}/observations/replay?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&entity_type=aircraft`
      )
      if (!res.ok) return
      const data = await res.json() as {
        entities: Record<string, { entity_type: string; display_name: string; points: ObsPoint[] }>
      }
      const flights: Record<string, ReplayEntity> = {}
      for (const [id, info] of Object.entries(data.entities ?? {})) {
        flights[id] = {
          entity_id:    id,
          display_name: info.display_name || id,
          points:       info.points,
        }
      }
      setReplayFlights(flights)
    } catch { /* silent */ } finally {
      setLoadingReplay(false)
    }
  }, [])

  useEffect(() => { fetchReplay(timeWindow) }, [timeWindow, fetchReplay])

  // ── Fetch trail data for the selected aircraft (used for stats) ────────────
  useEffect(() => {
    if (!selectedEntityId) { setTrailPoints([]); return }
    const live   = entities[selectedEntityId]
    const inLog  = replayFlights[selectedEntityId]
    if (!live && !inLog) { setTrailPoints([]); return }

    setLoadingTrail(true)
    fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}/trail?minutes=${timeWindow}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: ObsPoint[]) => setTrailPoints(data))
      .catch(() => setTrailPoints([]))
      .finally(() => setLoadingTrail(false))
  }, [selectedEntityId, timeWindow, entities, replayFlights])

  // ── Keep detailEntity in sync (live updates + API fetch for historical) ────
  useEffect(() => {
    if (!selectedEntityId) { setDetailEntity(null); return }
    const live = entities[selectedEntityId]
    if (live) { setDetailEntity(live); return }

    // Fetch from API for historical entities (guard against duplicate fetches)
    if (lastFetchedDetailId.current !== selectedEntityId) {
      lastFetchedDetailId.current = selectedEntityId
      fetch(`${API_BASE}/entities/${encodeURIComponent(selectedEntityId)}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: Entity | null) => setDetailEntity(d))
        .catch(() => {})
    }
  }, [selectedEntityId, entities])

  // ── Build merged flight list (replay + live store) ─────────────────────────
  const allFlights = useMemo((): FlightEntry[] => {
    const map = new Map<string, FlightEntry>()
    const cutoffMs = Date.now() - timeWindow * 60_000

    // Seed from replay data (historical observation window)
    for (const [id, flight] of Object.entries(replayFlights)) {
      const times = flight.points
        .map(p => Date.parse(p.ts))
        .filter(t => !isNaN(t))
        .sort((a, b) => a - b)
      map.set(id, {
        entityId:    id,
        displayName: flight.display_name,
        firstSeen:   times.length ? new Date(times[0]).toISOString()                  : '',
        lastSeen:    times.length ? new Date(times[times.length - 1]).toISOString()   : '',
        liveEntity:  entities[id] ?? null,
      })
    }

    // Merge live aircraft not yet flushed to observations DB
    for (const entity of Object.values(entities)) {
      if (entity.entity_type !== 'aircraft') continue
      if (map.has(entity.entity_id)) {
        // Update the liveEntity reference in case it arrived via WebSocket
        const existing = map.get(entity.entity_id)!
        map.set(entity.entity_id, { ...existing, liveEntity: entity })
        continue
      }
      const lastSeenMs = entity.last_seen ? Date.parse(entity.last_seen) : Date.now()
      if (lastSeenMs >= cutoffMs) {
        map.set(entity.entity_id, {
          entityId:    entity.entity_id,
          displayName: entity.display_name || entity.entity_id.split(':').pop()?.toUpperCase() || entity.entity_id,
          firstSeen:   entity.last_seen ?? '',
          lastSeen:    entity.last_seen ?? '',
          liveEntity:  entity,
        })
      }
    }

    return [...map.values()].sort((a, b) => {
      // Live aircraft first, then sorted by lastSeen descending
      const aLive = a.liveEntity != null ? 1 : 0
      const bLive = b.liveEntity != null ? 1 : 0
      if (aLive !== bLive) return bLive - aLive
      return Date.parse(b.lastSeen || '0') - Date.parse(a.lastSeen || '0')
    })
  }, [replayFlights, entities, timeWindow])

  const filteredFlights = useMemo(() => {
    if (!search) return allFlights
    const q = search.toLowerCase()
    return allFlights.filter(f => {
      const callsign = ((f.liveEntity?.identity?.['callsign'] as string) || f.displayName || '').toLowerCase()
      const reg      = ((f.liveEntity?.identity?.['registration'] as string) || '').toLowerCase()
      const type     = ((f.liveEntity?.identity?.['icao_type'] as string) || '').toLowerCase()
      const operator = ((f.liveEntity?.identity?.['operator'] as string) || '').toLowerCase()
      const icao24   = f.entityId.split(':').pop()?.toLowerCase() || ''
      return callsign.includes(q) || reg.includes(q) || type.includes(q) || operator.includes(q) || icao24.includes(q)
    })
  }, [allFlights, search])

  // Summary stats across all aircraft in window
  const summaryStats = useMemo(() => {
    const live = allFlights.map(f => f.liveEntity).filter((e): e is Entity => e != null)
    const alts = live.map(e => e.altitude).filter((a): a is number => a != null)
    const spds = live.map(e => e.speed).filter((s): s is number => s != null)
    return {
      total:     allFlights.length,
      liveCount: live.length,
      avgAlt:    alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : null,
      maxAlt:    alts.length ? Math.max(...alts)                                           : null,
      avgSpd:    spds.length ? Math.round(spds.reduce((a, b) => a + b, 0) / spds.length)  : null,
      withRoute: live.filter(e => e.identity?.['origin'] || e.identity?.['destination']).length,
    }
  }, [allFlights])

  const selectedFlightStats = useMemo(() => computeStats(trailPoints), [trailPoints])

  const twLabel = TIME_WINDOWS.find(w => w.minutes === timeWindow)?.label ?? ''

  const handleSelectFlight = useCallback((entityId: string) => {
    selectEntity(selectedEntityId === entityId ? null : entityId)
  }, [selectedEntityId, selectEntity])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full z-10 flex flex-col overflow-hidden bg-onyx-black/20 backdrop-blur-md">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center gap-3 shrink-0 flex-wrap gap-y-2">
        <span className="ms text-[18px] text-cyan-adsb leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
          flight
        </span>
        <h2 className="font-bold text-sm uppercase tracking-tight text-on-surface">Flight Log</h2>

        {/* Time window buttons */}
        <div className="flex items-center gap-1 ml-2">
          {TIME_WINDOWS.map(w => (
            <button
              key={w.label}
              type="button"
              onClick={() => setTimeWindow(w.minutes)}
              className={`font-mono text-[9px] px-2 py-0.5 uppercase tracking-widest transition-colors ${
                timeWindow === w.minutes
                  ? 'bg-cyan-adsb text-onyx-black font-bold'
                  : 'text-on-surface-variant hover:text-cyan-adsb border border-white/10 hover:border-cyan-adsb/40'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loadingReplay && (
            <span className="font-mono text-[9px] text-on-surface-variant/60 animate-pulse uppercase">Fetching...</span>
          )}
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-adsb animate-pulse" />
          <span className="font-mono text-[9px] text-cyan-adsb uppercase tracking-widest">ADS-B</span>
        </div>
      </div>

      {/* ── Body: two-column layout ── */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col lg:flex-row">

        {/* ── Left column: stats + selected aircraft detail ── */}
        <div className="lg:w-80 xl:w-96 shrink-0 flex flex-col border-r border-white/10 overflow-y-auto">

          {/* Traffic summary */}
          <section className="p-4 border-b border-white/10 shrink-0">
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[14px] text-cyan-adsb">analytics</span>
              Traffic Summary
              <span className="ml-auto font-mono text-[9px] text-on-surface-variant">{twLabel} window</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Total Observed"  value={String(summaryStats.total)}     unit="aircraft" colorClass="text-cyan-adsb"  />
              <StatCard label="Currently Live"  value={String(summaryStats.liveCount)} unit="airborne" colorClass="text-green-ais"  />
              <StatCard label="Avg Altitude"
                value={summaryStats.avgAlt != null ? summaryStats.avgAlt.toLocaleString() : '--'}
                unit="ft MSL" colorClass="text-amber-gold"
              />
              <StatCard label="Peak Altitude"
                value={summaryStats.maxAlt != null ? summaryStats.maxAlt.toLocaleString() : '--'}
                unit="ft MSL" colorClass="text-amber-gold"
              />
            </div>
          </section>

          {/* Selected aircraft detail */}
          {selectedEntityId && (detailEntity || replayFlights[selectedEntityId]) ? (
            <section className="flex-1 p-4 space-y-4 pb-24 overflow-y-auto">
              <h3 className="section-heading flex items-center gap-2">
                <span className="ms text-[14px] text-cyan-adsb">manage_search</span>
                Selected Aircraft
                <button
                  type="button"
                  onClick={() => selectEntity(null)}
                  className="ml-auto text-on-surface-variant hover:text-white transition-colors"
                  aria-label="Deselect aircraft"
                >
                  <span className="ms text-[14px]">close</span>
                </button>
              </h3>

              {/* Flight trail mini-map */}
              <FlightMiniMap trailPoints={trailPoints} entity={detailEntity} />

              {/* Identity card */}
              <div className="p-3 border border-cyan-adsb/30 bg-cyan-adsb/5 rounded-sm space-y-1.5">
                <div className="flex items-start justify-between border-b border-cyan-adsb/10 pb-2 mb-2">
                  <div>
                    <div className="font-mono text-[8px] text-cyan-adsb/70 uppercase tracking-widest mb-0.5">Callsign</div>
                    <div className="font-black text-lg text-on-surface uppercase leading-none tracking-tight">
                      {getIdent(detailEntity, 'callsign') !== '--'
                        ? getIdent(detailEntity, 'callsign')
                        : (replayFlights[selectedEntityId]?.display_name
                          || selectedEntityId.split(':').pop()?.toUpperCase()
                          || '------')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest mb-0.5">ICAO 24</div>
                    <div className="font-mono text-[11px] text-on-surface">{selectedEntityId.split(':').pop()?.toUpperCase()}</div>
                  </div>
                </div>
                <InfoRow label="Registration"  value={getIdent(detailEntity, 'registration')} />
                <InfoRow label="Aircraft Type" value={getIdent(detailEntity, 'type')} />
                <InfoRow label="ICAO Type"     value={getIdent(detailEntity, 'icao_type')} />
                <InfoRow label="Operator"      value={getIdent(detailEntity, 'operator')} />
                <InfoRow label="Country"       value={getIdent(detailEntity, 'operator_country')} />
              </div>

              {/* Route */}
              {detailEntity && !!(detailEntity.identity?.['origin'] || detailEntity.identity?.['destination']) && (
                <div className="p-3 border border-white/10 bg-white/5 rounded-sm">
                  <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest mb-3">Route</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-center flex-1 min-w-0">
                      <div className="font-black text-base text-on-surface">{getIdent(detailEntity, 'origin')}</div>
                      <div className="font-mono text-[7px] text-on-surface-variant truncate">
                        {nestedStr(detailEntity, 'origin_info', 'city') || 'Origin'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="w-5 h-px bg-white/20" />
                      <span className="ms text-[13px] text-cyan-adsb" style={{ fontVariationSettings: "'FILL' 1" }}>flight</span>
                      <div className="w-5 h-px bg-white/20" />
                    </div>
                    <div className="text-center flex-1 min-w-0">
                      <div className="font-black text-base text-on-surface">{getIdent(detailEntity, 'destination')}</div>
                      <div className="font-mono text-[7px] text-on-surface-variant truncate">
                        {nestedStr(detailEntity, 'dest_info', 'city') || 'Destination'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Live position */}
              {detailEntity && (
                <div className="p-3 border border-white/10 bg-white/5 rounded-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">Live Position</div>
                    {entities[selectedEntityId] && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-ais animate-pulse" />
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                    <LiveStat label="Altitude"
                      value={fmtAlt(detailEntity.altitude)}
                    />
                    <LiveStat label="Speed"
                      value={fmtSpd(detailEntity.speed)}
                    />
                    <LiveStat label="Heading"
                      value={detailEntity.heading != null ? `${Math.round(detailEntity.heading)}°` : '--'}
                    />
                    <LiveStat label="Vert Rate"
                      value={detailEntity.vertical_rate != null
                        ? `${detailEntity.vertical_rate > 0 ? '+' : ''}${Math.round(detailEntity.vertical_rate)} fpm`
                        : '--'}
                    />
                    <LiveStat label="Distance"
                      value={detailEntity.distance_km != null ? `${detailEntity.distance_km.toFixed(1)} km` : '--'}
                    />
                    <LiveStat label="Phase"
                      value={(getIdent(detailEntity, 'phase')).toUpperCase()}
                    />
                  </div>
                </div>
              )}

              {/* Flight statistics (derived from observation trail) */}
              <div className="p-3 border border-white/10 bg-white/5 rounded-sm">
                <div className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest mb-2 flex items-center gap-2">
                  Flight Statistics
                  <span className="text-amber-gold/60 text-[7px]">({twLabel})</span>
                  {loadingTrail && <span className="ml-auto animate-pulse text-[7px] text-on-surface-variant/50">loading…</span>}
                </div>
                {selectedFlightStats ? (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <LiveStat label="Max Altitude"   value={fmtAlt(selectedFlightStats.maxAltFt)}    />
                      <LiveStat label="Min Altitude"   value={fmtAlt(selectedFlightStats.minAltFt)}    />
                      <LiveStat label="Max Speed"      value={fmtSpd(selectedFlightStats.maxSpeedKts)} />
                      <LiveStat label="Avg Speed"      value={fmtSpd(selectedFlightStats.avgSpeedKts)} />
                      <LiveStat label="Duration"       value={`${selectedFlightStats.durationMin} min`} />
                      <LiveStat label="Track Points"   value={String(selectedFlightStats.pointCount)}  />
                    </div>
                    <div className="mt-3 pt-2 border-t border-white/5 grid grid-cols-2 gap-3">
                      <div>
                        <div className="font-mono text-[7px] text-on-surface-variant/60 uppercase">First Seen</div>
                        <div className="font-mono text-[8px] text-on-surface mt-0.5">{fmtDateTime(selectedFlightStats.firstSeen)}</div>
                      </div>
                      <div>
                        <div className="font-mono text-[7px] text-on-surface-variant/60 uppercase">Last Seen</div>
                        <div className="font-mono text-[8px] text-on-surface mt-0.5">{fmtDateTime(selectedFlightStats.lastSeen)}</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-3 text-center text-[9px] font-mono text-on-surface-variant/30 uppercase">
                    {loadingTrail ? 'Fetching trail…' : 'No observations in window'}
                  </div>
                )}
              </div>
            </section>

          ) : selectedEntityId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-on-surface-variant/30 p-8">
              <span className="ms text-3xl animate-pulse">radar</span>
              <span className="text-[10px] uppercase tracking-widest font-mono text-center">Loading aircraft data…</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-on-surface-variant/30 p-8">
              <span className="ms text-5xl">flight</span>
              <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-center leading-relaxed">
                Select an aircraft<br />to view flight details
              </span>
            </div>
          )}
        </div>

        {/* ── Right column: aircraft list ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Search bar */}
          <div className="px-3 py-2 border-b border-white/10 shrink-0 flex items-center gap-2 bg-white/5">
            <span className="ms text-[14px] text-on-surface-variant">search</span>
            <input
              type="text"
              placeholder="Callsign, type, registration, operator, ICAO…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[11px] text-on-surface placeholder-on-surface-variant/50 focus:outline-none"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-on-surface-variant hover:text-white transition-colors">
                <span className="ms text-[14px]">close</span>
              </button>
            )}
          </div>

          {/* Column headers */}
          <div className="px-3 py-1.5 bg-white/5 border-b border-white/5 flex items-center justify-between shrink-0">
            <span className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">Aircraft · Type</span>
            <span className="font-mono text-[8px] text-on-surface-variant uppercase tracking-widest">Phase · Alt · Spd</span>
          </div>

          {/* List body */}
          <div className="flex-1 overflow-y-auto">
            {loadingReplay && allFlights.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-on-surface-variant/30 py-16">
                <span className="ms text-4xl animate-pulse">radar</span>
                <span className="text-[11px] uppercase tracking-[0.2em] font-mono">Fetching flight data…</span>
              </div>
            ) : filteredFlights.length > 0 ? (
              filteredFlights.map(f => (
                <AircraftRow
                  key={f.entityId}
                  entityId={f.entityId}
                  displayName={f.displayName}
                  liveEntity={f.liveEntity}
                  isSelected={selectedEntityId === f.entityId}
                  lastSeen={f.lastSeen}
                  onClick={() => handleSelectFlight(f.entityId)}
                />
              ))
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 text-on-surface-variant/30 py-16">
                <span className="ms text-4xl">flight_takeoff</span>
                <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-center">
                  {search
                    ? 'No aircraft match your search'
                    : `No aircraft observed in the last ${twLabel}`}
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/5 bg-white/5 flex items-center justify-between shrink-0">
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">
              {filteredFlights.length} aircraft
              {search ? ` matching "${search}"` : ` in ${twLabel} window`}
            </span>
            {selectedEntityId && (detailEntity || replayFlights[selectedEntityId]) && (
              <span className="font-mono text-[9px] text-cyan-adsb uppercase flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-cyan-adsb animate-pulse" />
                selected
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
