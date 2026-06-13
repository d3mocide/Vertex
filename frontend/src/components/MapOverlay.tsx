import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Entity, Track, TrafficCamera, EntityTypeFilter, RangeFilter, ReplayData, SystemEvent } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { buildCameraLayer } from '../layers/buildCameraLayer'
import { buildEventLayers } from '../layers/buildEventLayers'
import { buildAnnotationLayers, buildAnnotationDrawPreviewLayers } from '../layers/AnnotationLayer'
import { buildGeofenceLayers, type GeofenceItem } from '../layers/buildGeofenceLayers'
import { buildObservationRingLayers } from '../layers/buildObservationRingLayer'
import { buildCustomLayers } from '../layers/buildCustomLayers'
import { buildLightningLayer } from '../layers/buildLightningLayer'
import { buildStreamGaugeLayers, type StreamGaugePoint } from '../layers/buildStreamGaugeLayer'
import { buildMeshNodeLayers, type MeshNodePoint } from '../layers/buildMeshNodeLayer'

import { extractRailSegments, snapPointToRail, type RailSegment } from '../layers/railSnap'
import { applyPVB, type PVBState } from '../layers/pvb'
import { DEFAULT_CENTER, OBSERVATION_RANGE_KM, API_BASE } from '../config'
import { authHeaders } from '../auth'
import type { LightningStrike } from '../store'

interface Props {
  map: maplibregl.Map
}

const ALT_FT_TO_M  = 0.3048
const SPD_KT_TO_MS = 0.5144
const TRAIN_SNAP_MAX_M = 1_500

type RailSnapCacheEntry = {
  lastSeen: string | undefined
  rawLon: number
  rawLat: number
  snappedLon: number
  snappedLat: number
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

function escHtml(s: unknown): string {
  const span = document.createElement('span')
  span.textContent = String(s ?? '')
  return span.innerHTML
}

function buildReplayTracks(data: ReplayData, atMs: number): Record<string, Track> {
  const result: Record<string, Track> = {}
  for (const [uid, entity] of Object.entries(data.entities)) {
    const pts = entity.points
    if (pts.length === 0) continue

    // Find the two surrounding points for interpolation
    let lo = 0, hi = pts.length - 1
    for (let i = 0; i < pts.length; i++) {
      if (Date.parse(pts[i].ts) <= atMs) lo = i
    }
    hi = Math.min(lo + 1, pts.length - 1)

    const a = pts[lo], b = pts[hi]
    const aMs = Date.parse(a.ts), bMs = Date.parse(b.ts)
    const t = aMs === bMs ? 0 : Math.max(0, Math.min(1, (atMs - aMs) / (bMs - aMs)))

    const lat = lerp(a.lat, b.lat, t)
    const lon = lerp(a.lon, b.lon, t)
    const altMeters = lerp(a.altitude ?? 0, b.altitude ?? 0, t) * ALT_FT_TO_M
    const speedMs   = lerp(a.speed ?? 0, b.speed ?? 0, t) * SPD_KT_TO_MS
    const courseTrue = b.heading ?? a.heading ?? 0

    const isAir = entity.entity_type === 'aircraft'
    result[uid] = {
      uid,
      source: 'replay',
      lat, lon, altMeters, speedMs, courseTrue,
      type:     isAir ? 'air' : 'sea',
      callsign: entity.display_name ?? uid,
      category: undefined,
      trail:         pts.filter((p) => Date.parse(p.ts) <= atMs).map(
        (p) => [p.lon, p.lat, (p.altitude ?? 0) * ALT_FT_TO_M, (p.speed ?? 0) * SPD_KT_TO_MS, p.ts] as [number, number, number, number, string]
      ).slice(-150),
      smoothedTrail: [],
      predictedPath: [],
    }
  }
  return result
}

function getViewState(map: maplibregl.Map) {
  const { lng, lat } = map.getCenter()
  return {
    longitude: lng,
    latitude:  lat,
    zoom:      map.getZoom(),
    pitch:     map.getPitch(),
    bearing:   map.getBearing(),
  }
}

export function MapOverlay({ map }: Props) {
  const deckRef           = useRef<Deck | null>(null)
  const layersRef         = useRef<any[]>([])
  const entitiesRef       = useRef<Record<string, Entity>>({})
  const tracksRef         = useRef<Record<string, Track>>({})
  const pvbRef            = useRef<Record<string, PVBState>>({})
  const selectedRef       = useRef<string | null>(null)
  const camerasRef        = useRef<TrafficCamera[]>([])
  const selectedCamRef    = useRef<string | null>(null)
  const activeTabRef      = useRef<string>('safety')
  const entityFilterRef   = useRef<EntityTypeFilter>({ aircraft: true, adsbLocal: true, adsbSupplement: true, vessel: true, mesh_node: true, aprs: true, fire_incident: true, satellite: true, rf_sensor: true, train: true })
  const searchQueryRef    = useRef<string>('')
  const altRangeRef       = useRef<RangeFilter>([0, 60_000])
  const speedRangeRef     = useRef<RangeFilter>([0, 600])
  const replayModeRef     = useRef<boolean>(false)
  const replayDataRef     = useRef<ReplayData | null>(null)
  const replayTsRef       = useRef<number>(0)
  const cycleRef          = useRef(0)
  const rafRef            = useRef(0)

  // Keep refs in sync — no loop restart on state change
  const tracks           = useCivicStore((s) => s.tracks)
  const entities         = useCivicStore((s) => s.entities)
  const selectedId       = useCivicStore((s) => s.selectedEntityId)
  const cameras          = useCivicStore((s) => s.cameras)
  const selectedCamId    = useCivicStore((s) => s.selectedCamId)
  const camerasVisible   = useCivicStore((s) => s.camerasVisible)
  const activeTab        = useCivicStore((s) => s.activeTab)
  const entityFilter      = useCivicStore((s) => s.entityFilter)
  const entitySearchQuery = useCivicStore((s) => s.entitySearchQuery)
  const entityAltRange    = useCivicStore((s) => s.entityAltRange)
  const entitySpeedRange  = useCivicStore((s) => s.entitySpeedRange)
  const replayMode        = useCivicStore((s) => s.replayMode)
  const replayData        = useCivicStore((s) => s.replayData)
  const replayCurrentTs   = useCivicStore((s) => s.replayCurrentTs)
  const systemEvents      = useCivicStore((s) => s.systemEvents)
  const entityMissionTags = useCivicStore((s) => s.entityMissionTags)
  const lightningStrikes   = useCivicStore((s) => s.lightningStrikes)
  const lightningVisible   = useCivicStore((s) => s.lightningVisible)
  const gaugesVisible      = useCivicStore((s) => s.gaugesVisible)
  const selectEntity      = useCivicStore((s) => s.selectEntity)
  const setSelectedCamId  = useCivicStore((s) => s.setSelectedCamId)
  const setActiveTab      = useCivicStore((s) => s.setActiveTab)
  const geofencesVisible  = useCivicStore((s) => s.geofencesVisible)
  const trailsVisible     = useCivicStore((s) => s.trailsVisible)
  const annotations       = useCivicStore((s) => s.annotations)
  const annotationsVisible = useCivicStore((s) => s.annotationsVisible)
  const customLayers      = useCivicStore((s) => s.customLayers)
  const annotationDrawMode = useCivicStore((s) => s.annotationDrawMode)
  const annotationDrawPoints = useCivicStore((s) => s.annotationDrawPoints)
  const annotationDrawCursor = useCivicStore((s) => s.annotationDrawCursor)
  const annotationDrawModeRef = useRef<'marker' | 'line' | 'polygon' | null>(null)
  const annotationDrawPointsRef = useRef<[number, number][]>([])
  const annotationDrawCursorRef = useRef<[number, number] | null>(null)
  useEffect(() => { annotationDrawModeRef.current = annotationDrawMode }, [annotationDrawMode])
  useEffect(() => { annotationDrawPointsRef.current = annotationDrawPoints }, [annotationDrawPoints])
  useEffect(() => { annotationDrawCursorRef.current = annotationDrawCursor }, [annotationDrawCursor])
  const annotationsRef = useRef(annotations)
  const annotationsVisibleRef = useRef(annotationsVisible)
  const customLayersRef = useRef(customLayers)
  const geofencesRef = useRef<GeofenceItem[]>([])
  const gaugeFallbackRef = useRef<Entity[]>([])
  const railSegmentsRef = useRef<RailSegment[]>([])
  const railSnapCacheRef = useRef<Record<string, RailSnapCacheEntry>>({})
  useEffect(() => { annotationsRef.current = annotations }, [annotations])
  useEffect(() => { annotationsVisibleRef.current = annotationsVisible }, [annotationsVisible])
  useEffect(() => { customLayersRef.current = customLayers }, [customLayers])
  useEffect(() => { tracksRef.current = tracks                  }, [tracks])
  useEffect(() => { selectedRef.current = selectedId            }, [selectedId])
  useEffect(() => { camerasRef.current = cameras                }, [cameras])
  useEffect(() => { selectedCamRef.current = selectedCamId      }, [selectedCamId])
  useEffect(() => { entityFilterRef.current = entityFilter      }, [entityFilter])
  useEffect(() => { searchQueryRef.current = entitySearchQuery  }, [entitySearchQuery])
  useEffect(() => { altRangeRef.current = entityAltRange        }, [entityAltRange])
  useEffect(() => { speedRangeRef.current = entitySpeedRange    }, [entitySpeedRange])
  useEffect(() => { replayModeRef.current = replayMode          }, [replayMode])
  useEffect(() => { replayDataRef.current = replayData          }, [replayData])
  useEffect(() => { replayTsRef.current = replayCurrentTs       }, [replayCurrentTs])
  
  const systemEventsRef = useRef<SystemEvent[]>([])
  useEffect(() => { systemEventsRef.current = systemEvents }, [systemEvents])
  const lightningRef = useRef<LightningStrike[]>([])
  const lightningVisibleRef = useRef(true)
  const gaugesVisibleRef = useRef(true)
  useEffect(() => { entitiesRef.current = entities }, [entities])
  useEffect(() => { gaugesVisibleRef.current = gaugesVisible }, [gaugesVisible])
  useEffect(() => { lightningRef.current = lightningStrikes }, [lightningStrikes])
  useEffect(() => { lightningVisibleRef.current = lightningVisible }, [lightningVisible])
  const camerasVisibleRef = useRef(false)
  useEffect(() => { camerasVisibleRef.current = camerasVisible  }, [camerasVisible])
  useEffect(() => { activeTabRef.current = activeTab            }, [activeTab])
  const geofencesVisibleRef = useRef(true)
  useEffect(() => { geofencesVisibleRef.current = geofencesVisible }, [geofencesVisible])
  const trailsVisibleRef = useRef(true)
  useEffect(() => { trailsVisibleRef.current = trailsVisible }, [trailsVisible])
  useEffect(() => {
    let cancelled = false
    const loadGeofences = async () => {
      try {
        const res = await fetch(`${API_BASE}/geofences`, { headers: authHeaders() })
        if (!res.ok || cancelled) return
        const data: GeofenceItem[] = await res.json()
        if (!cancelled) geofencesRef.current = data
      } catch {
        // best effort
      }
    }
    loadGeofences()
    const interval = setInterval(loadGeofences, 30000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadRailSegments = async () => {
      try {
        const res = await fetch(`${API_BASE}/rail/tracks`, { headers: authHeaders() })
        if (!res.ok || cancelled) return
        const geojson = await res.json()
        if (cancelled) return
        const segments = extractRailSegments(geojson)
        if (segments.length > 0) railSegmentsRef.current = segments
      } catch {
        // best effort
      }
    }

    loadRailSegments()
    const interval = setInterval(() => {
      if (railSegmentsRef.current.length === 0) loadRailSegments()
    }, 30_000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadGaugeFallback = async () => {
      try {
        const res = await fetch(`${API_BASE}/entities?entity_type=stream_gauge`, {
          headers: authHeaders(),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data)) {
          gaugeFallbackRef.current = data as Entity[]
        }
      } catch {
        // best effort
      }
    }

    loadGaugeFallback()
    const interval = setInterval(loadGaugeFallback, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
  const missionTagsRef = useRef<Record<string, [number, number, number, number]>>({})
  useEffect(() => {
    const colorMap: Record<string, [number, number, number, number]> = {}
    for (const [entityId, tags] of Object.entries(entityMissionTags)) {
      if (tags.length > 0) {
        const hex = tags[0].color.replace('#', '')
        const r = parseInt(hex.slice(0, 2), 16)
        const g = parseInt(hex.slice(2, 4), 16)
        const b = parseInt(hex.slice(4, 6), 16)
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          colorMap[entityId] = [r, g, b, 220]
        }
      }
    }
    missionTagsRef.current = colorMap
  }, [entityMissionTags])

  useEffect(() => {
    const container = map.getContainer()

    // Overlay canvas: sits on top of the MapLibre canvas, passes events through.
    const canvas = document.createElement('canvas')
    canvas.id = 'deck-overlay-canvas'
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;'
    canvas.width  = container.clientWidth
    canvas.height = container.clientHeight
    container.appendChild(canvas)

    // Deck defaults to MapView with flat viewState — no views[] needed.
    let deckReady = false
    const deck = new Deck({
      canvas,
      width:            container.clientWidth,
      height:           container.clientHeight,
      controller:       false,    // MapLibre owns all user input
      initialViewState: getViewState(map),
      layers:           [],
      onLoad:           () => { deckReady = true },
    })
    deckRef.current = deck

    // Unified SA Tooltip Bridge
    const tooltip = document.createElement('div')
    tooltip.className = 'absolute pointer-events-none z-[100] opacity-0 transition-opacity duration-150'
    container.appendChild(tooltip)

    const onMapMouseMove = (e: maplibregl.MapMouseEvent) => {
      const isMobileViewport = window.innerWidth < 1024
      if (isMobileViewport) {
        tooltip.style.opacity = '0'
        map.getCanvas().style.cursor = ''
        return
      }

      // 1. Pick from Deck.gl — guard until the GL context is ready
      if (!deckReady) return
      const picked = deck.pickObject({ x: e.point.x, y: e.point.y, radius: 5 })

      let html = ''
      
      if (picked?.object && picked.layer) {
        const { object, layer } = picked
        if (layer.id === 'entity-icons') {
          const t = object as Track
          const isTak = t.type === 'tak' || t.source.toLowerCase().includes('tak')
          if (isTak && isMobileViewport) {
            tooltip.style.opacity = '0'
            map.getCanvas().style.cursor = ''
            return
          }
          const isAir    = t.type === 'air'
          const isRail   = t.type === 'rail'
          const isGround = t.type === 'ground'
          const isHazard = t.type === 'hazard'
          const ALT_M_TO_FT = 3.28084
          const MS_TO_KT    = 1.94384

          const tooltipIcon = isAir ? 'flight' 
            : isRail ? 'directions_railway' 
            : isGround ? 'sensors' 
            : isHazard ? 'local_fire_department' 
            : 'sailing'

          const tooltipColor = isAir ? 'text-blue-400' 
            : isRail ? 'text-amber-400' 
            : isGround ? 'text-cyan-400' 
            : isHazard ? 'text-red-400' 
            : 'text-teal-400'

          const sourceLabel = isAir ? 'ADS-B' 
            : isRail ? escHtml(t.source.toUpperCase()) 
            : isGround ? 'APRS' 
            : isHazard ? 'INTEL' 
            : 'AIS'

          const statusLabel = isAir ? 'Airborne' 
            : isRail ? 'En Route' 
            : isGround ? 'Station' 
            : isHazard ? 'Active' 
            : 'Underway'
          html = `
            <div class="p-2 min-w-[160px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center justify-between mb-2 border-b border-slate-700/50 pb-1.5">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[16px] ${tooltipColor}">${tooltipIcon}</span>
                  <span class="font-bold text-white uppercase tracking-wider text-[11px] truncate">${escHtml(t.callsign || t.uid)}</span>
                </div>
                <span class="text-[11px] text-slate-500 font-mono">${sourceLabel}</span>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-slate-400 font-mono">
                 ${isAir ? `<span>ALT:</span><span class="text-blue-200 text-right">${Math.round(t.altMeters * ALT_M_TO_FT).toLocaleString()} FT</span>` : ''}
                 <span>SPD:</span><span class="text-white text-right">${Math.round(t.speedMs * MS_TO_KT)} KTS</span>
                 <span>HDG:</span><span class="text-white text-right">${Math.round(t.courseTrue).toString().padStart(3, '0')}°</span>
                 ${t.category ? `<span>CAT:</span><span class="text-amber-400 text-right uppercase">${escHtml(t.category)}</span>` : ''}
              </div>
              <div class="mt-2 pt-1 border-t border-white/5 text-[11px] text-slate-500 flex justify-between uppercase">
                <span>ID: ${escHtml(t.uid.slice(0, 8))}</span>
                <span>${statusLabel}</span>
              </div>
            </div>
          `
        } else if (layer.id === 'camera-points') {
          const cam = object as TrafficCamera
          html = `
            <div class="p-2 min-w-[180px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1.5">
                 <span class="material-symbols-outlined text-[16px] text-amber-400">videocam</span>
                 <span class="truncate">${escHtml(cam.name)}</span>
              </div>
              <div class="space-y-1">
                ${cam.road ? `<div class="text-[11px] text-slate-300 flex items-center gap-1.5"><span class="ms text-[12px] text-slate-500">add_road</span> ${escHtml(cam.road)}</div>` : ''}
                <div class="text-[11px] text-slate-400 italic flex justify-between">
                  <span>${cam.road ? 'Traffic Cam' : escHtml((cam as any).provider || 'Regional Network')}</span>
                  ${cam.dist_km ? `<span>${cam.dist_km.toFixed(1)} km</span>` : ''}
                </div>
              </div>
            </div>
          `
        } else if (layer.id === 'event-points') {
          const ev = object as SystemEvent
          const ageHours = Math.max(0, (Date.now() - Date.parse(ev.ts)) / 3600_000)
          const ageStr = ageHours < 1 ? '< 1h ago' : `${Math.floor(ageHours)}h ago`

          let color = 'text-slate-400'
          if (ev.severity === 'high') color = 'text-red-400'
          else if (ev.severity === 'medium') color = 'text-amber-400'
          else if (ev.severity === 'low') color = 'text-cyan-400'

          html = `
            <div class="p-2 min-w-[200px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1.5">
                 <span class="material-symbols-outlined text-[16px] ${color}">crisis_alert</span>
                 <span class="truncate uppercase">${escHtml(ev.event_type)}</span>
              </div>
              <div class="space-y-1">
                <div class="text-[11px] text-slate-300">${escHtml(ev.summary)}</div>
                <div class="text-[11px] text-slate-400 italic flex justify-between mt-1 pt-1 border-t border-slate-700/50">
                  <span class="uppercase">${escHtml(ev.severity)}</span>
                  <span>${ageStr}</span>
                </div>
              </div>
            </div>
          `
        } else if (layer.id === 'stream-gauge-dots') {
          const gauge = object as StreamGaugePoint
          html = `
            <div class="p-2 min-w-[210px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1.5">
                <span class="material-symbols-outlined text-[16px] text-cyan-400">waves</span>
                <span class="truncate">${escHtml(gauge.name)}</span>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-slate-400 font-mono">
                <span>STAGE:</span><span class="text-right text-white uppercase">${escHtml(gauge.stage)}</span>
                <span>FLOW:</span><span class="text-right text-cyan-200">${gauge.flow_cfs !== null ? `${Math.round(gauge.flow_cfs)} cfs` : 'n/a'}</span>
                <span>HEIGHT:</span><span class="text-right text-cyan-200">${gauge.height_ft !== null ? `${gauge.height_ft.toFixed(1)} ft` : 'n/a'}</span>
              </div>
            </div>
          `
        } else if (layer.id === 'mesh-node-dots') {
          const node = object as MeshNodePoint
          html = `
            <div class="p-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1">
                <span class="material-symbols-outlined text-[16px] ${node.stale ? 'text-slate-500' : 'text-green-500'}">hub</span>
                <span>${escHtml(node.name)}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full ${node.stale ? 'bg-slate-500' : 'bg-green-500 pulse-fast'}"></div>
                <div class="text-[11px] text-slate-400 font-mono">${node.stale ? 'STALE / OFFLINE' : 'ACTIVE / ONLINE'}</div>
              </div>
              ${node.status ? `<div class="text-[11px] text-slate-500 font-mono mt-1">${escHtml(node.status)}</div>` : ''}
            </div>
          `
        } else if (layer.id === 'geofence-fill') {
          const geofence = object as GeofenceItem
          html = `
            <div class="p-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1">
                <span class="material-symbols-outlined text-[16px] text-blue-400">verified_user</span>
                <span>${escHtml(geofence.name)}</span>
              </div>
              <div class="text-[11px] text-slate-400 font-mono uppercase tracking-tighter">${escHtml(geofence.zone_type)} Zone</div>
            </div>
          `
        } else if (layer.id.startsWith('custom-')) {
          html = `
            <div class="p-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="text-[11px] text-slate-400 font-mono">Custom layer</div>
            </div>
          `
        }
      }

      if (html) {
        tooltip.innerHTML = html
        tooltip.style.opacity = '1'
        tooltip.style.left = `${e.point.x + 15}px`
        tooltip.style.top = `${e.point.y + 15}px`
        map.getCanvas().style.cursor = 'pointer'
      } else {
        tooltip.style.opacity = '0'
        map.getCanvas().style.cursor = ''
      }
    }

    map.on('mousemove', onMapMouseMove)
    map.on('mouseleave', () => { tooltip.style.opacity = '0' })

    // Allow selecting entities and cameras while preserving normal map interaction.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (annotationDrawModeRef.current) return
      if (!deckReady) return
      const picked = deck.pickObject({ x: e.point.x, y: e.point.y, radius: 10 })
      if (!picked) return
      if (picked.layer?.id === 'camera-points') {
        const cam = picked.object as TrafficCamera
        setSelectedCamId(cam.id)
      } else if (picked.layer?.id === 'stream-gauge-dots') {
        const gauge = picked.object as StreamGaugePoint | undefined
        if (gauge?.entity_id) selectEntity(gauge.entity_id)
      } else if (picked.layer?.id === 'mesh-node-dots') {
        const node = picked.object as MeshNodePoint | undefined
        if (node?.entity_id) selectEntity(node.entity_id)
      } else {
        const track = picked.object as Track | undefined
        if (track?.uid) selectEntity(track.uid)
      }
    }
    map.on('click', onMapClick)

    // Resize the overlay canvas when the map container resizes
    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight
      canvas.width  = w
      canvas.height = h
      deck.setProps({ width: w, height: h })
    })
    resizeObserver.observe(container)

    let last = performance.now()
    let lastLayerBuild = 0
    const LAYER_BUILD_INTERVAL_MS = 16

    // When the tab is backgrounded the browser pauses/throttles rAF while the
    // WebSocket keeps delivering position updates. On return, re-anchor motion
    // smoothing to current server truth instead of extrapolating across the
    // whole away-window — otherwise icons drift off and snap back. Clearing PVB
    // state makes applyPVB() re-seed each track at its reported position.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      last = performance.now()
      lastLayerBuild = 0
      pvbRef.current = {}
    }
    document.addEventListener('visibilitychange', onVisibility)

    const tick = (now: number) => {
      // Clamp dt so a paused/throttled rAF can't fast-forward the pulse phase.
      const dt = Math.min(now - last, 100)
      last = now
      cycleRef.current = (cycleRef.current + dt / 2000) % 1  // 2-second pulse

      // Sync Deck camera every frame — eliminates the 1-frame lag that occurs
      // when relying on map.on('render') because that fires after MapLibre paints,
      // causing Deck to always be one RAF behind during map movement.
      deck.setProps({ viewState: getViewState(map) })

      const shouldRebuildLayers = (now - lastLayerBuild >= LAYER_BUILD_INTERVAL_MS)
      if (!shouldRebuildLayers) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastLayerBuild = now

      const pvb = pvbRef.current
      const sel = selectedRef.current
      const nowMs = Date.now()

      let rawTracks: Record<string, Track>

      if (replayModeRef.current && replayDataRef.current) {
        // Replay mode: build synthetic tracks from historical observations
        rawTracks = buildReplayTracks(replayDataRef.current, replayTsRef.current)
      } else {
        // Live mode: apply entity type filter, text search, and range filters.
        const allTracks = tracksRef.current
        const ef  = entityFilterRef.current
        const q   = searchQueryRef.current.toLowerCase()
        const [minAlt, maxAlt] = altRangeRef.current
        const [minSpd, maxSpd] = speedRangeRef.current
        const ALT_M_TO_FT = 3.28084
        const MS_TO_KT    = 1.94384

        rawTracks = {}
        for (const [uid, track] of Object.entries(allTracks)) {
          if (track.type === 'air' && !ef.aircraft) continue
          if (track.type === 'air') {
            const source = (track.source ?? '').toLowerCase()
            const isSupplement = source === 'opensky'
            if (isSupplement && !ef.adsbSupplement) continue
            if (!isSupplement && !ef.adsbLocal) continue
          }
          if (track.type === 'sea' && !ef.vessel) continue
          if (track.type === 'ground' && !ef.aprs) continue
          if (track.type === 'hazard' && !ef.fire_incident) continue
          if (track.type === 'rail' && !ef.train) continue

          if (q) {
            const name = (track.callsign ?? uid).toLowerCase()
            if (!name.includes(q) && !uid.toLowerCase().includes(q)) continue
          }

          const altFt = track.altMeters * ALT_M_TO_FT
          if (track.type === 'air' && (altFt < minAlt || altFt > maxAlt)) continue

          const spdKt = track.speedMs * MS_TO_KT
          if (spdKt < minSpd || spdKt > maxSpd) continue

          rawTracks[uid] = track
        }
      }

      // Project each track forward from both the last server report and the last
      // visual position, then blend between them (Projective Velocity Blending).
      // Trail history stays raw on the Track object; the render-time lon/lat used by
      // trail-adjacent layers should match the icon position so stale BEAST tracks
      // do not visually detach from their own trail endpoint.
      // In replay mode, PVB is bypassed (positions already interpolated).
      const pvbTracks: Record<string, Track> = {}
      const railSegments = railSegmentsRef.current
      const railSnapCache = railSnapCacheRef.current
      for (const uid of Object.keys(rawTracks)) {
        const track = rawTracks[uid] as Track

        // Rail snapping is expensive against large OSM segment sets. Cache snap
        // results per raw report and only recompute when the server position updates.
        let snappedBase = track
        if (track.type === 'rail' && railSegments.length > 0) {
          const cached = railSnapCache[uid]
          if (
            cached &&
            cached.lastSeen === track.lastSeen &&
            cached.rawLon === track.lon &&
            cached.rawLat === track.lat
          ) {
            snappedBase = (cached.snappedLon === track.lon && cached.snappedLat === track.lat)
              ? track
              : { ...track, lon: cached.snappedLon, lat: cached.snappedLat }
          } else {
            const snapped = snapPointToRail(track.lon, track.lat, railSegments, TRAIN_SNAP_MAX_M)
            if (snapped) {
              railSnapCache[uid] = {
                lastSeen: track.lastSeen,
                rawLon: track.lon,
                rawLat: track.lat,
                snappedLon: snapped.lon,
                snappedLat: snapped.lat,
              }
              snappedBase = { ...track, lon: snapped.lon, lat: snapped.lat }
            } else {
              railSnapCache[uid] = {
                lastSeen: track.lastSeen,
                rawLon: track.lon,
                rawLat: track.lat,
                snappedLon: track.lon,
                snappedLat: track.lat,
              }
            }
          }
        }

        // Rail feeds can have coarse/irregular heading updates; extrapolation causes
        // visible drift. Keep trains on last reported (snapped) position until the
        // next real update arrives.
        if (replayModeRef.current || snappedBase.type === 'rail') {
          pvbTracks[uid] = snappedBase
        } else {
          const [lon, lat] = applyPVB(pvb, snappedBase, now)
          pvbTracks[uid] = (lon === snappedBase.lon && lat === snappedBase.lat)
            ? snappedBase
            : { ...snappedBase, lon, lat }
        }
      }

      // Remove PVB state for tracks that have been purged.
      if (!replayModeRef.current) {
        const allTracks = tracksRef.current
        for (const uid of Object.keys(pvb)) {
          if (!(uid in allTracks)) delete pvb[uid]
        }
        for (const uid of Object.keys(railSnapCache)) {
          if (!(uid in allTracks)) delete railSnapCache[uid]
        }
      }

      const zoom = map.getZoom()
      const layers = [
          ...buildCustomLayers(customLayersRef.current),
          ...buildGeofenceLayers(geofencesRef.current, geofencesVisibleRef.current),
          ...buildObservationRingLayers(DEFAULT_CENTER, OBSERVATION_RANGE_KM, true),
          ...buildMeshNodeLayers(
            Object.values(entitiesRef.current),
            entityFilterRef.current.mesh_node,
            nowMs,
            zoom,
          ),
          ...(() => {
            const wsGauges = Object.values(entitiesRef.current).filter((e) => e.entity_type === 'stream_gauge')
            const fallback = gaugeFallbackRef.current
            const source = wsGauges.length > 0 ? wsGauges : fallback
            return buildStreamGaugeLayers(source, gaugesVisibleRef.current, zoom)
          })(),
          ...buildTrailLayers(pvbTracks, sel, trailsVisibleRef.current),
          ...buildEntityLayers(pvbTracks, sel, cycleRef.current, zoom, missionTagsRef.current),
          ...buildEventLayers(systemEventsRef.current, nowMs),
          ...(lightningVisibleRef.current
            ? buildLightningLayer(lightningRef.current, nowMs, zoom)
            : []),
          ...(camerasVisibleRef.current
            ? [buildCameraLayer(camerasRef.current, selectedCamRef.current, zoom)]
            : []),
          ...buildAnnotationLayers(annotationsRef.current, annotationsVisibleRef.current),
          ...buildAnnotationDrawPreviewLayers({
            mode: annotationDrawModeRef.current,
            points: annotationDrawPointsRef.current,
            cursor: annotationDrawCursorRef.current,
          }),
      ]

      layersRef.current = layers
      deck.setProps({ layers })

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      map.off('click', onMapClick)
      map.off('mousemove', onMapMouseMove)
      resizeObserver.disconnect()
      deck.finalize()
      canvas.remove()
      tooltip.remove()
      deckRef.current = null
      pvbRef.current = {}
    }
  }, [map])

  return null
}
