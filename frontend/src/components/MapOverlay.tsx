import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Layer } from '@deck.gl/core'
import { MapLayerCache } from '../layers/mapLayerCache'
import { VisibleTrackCache } from '../layers/visibleTracks'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useCivicStore } from '../store'
import type { Entity, Track, TrafficCamera, EntityTypeFilter, SubFilters, RangeFilter, ReplayData, SystemEvent } from '../store'
import { orderOperationalLayers } from '../layers/layerPriority'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { terrainVersion } from '../layers/terrainElevation'
import { meshPassesFacets } from '../entityFacets'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { buildCameraLayer } from '../layers/buildCameraLayer'
import { buildEventLayers } from '../layers/buildEventLayers'
import { buildAnnotationLayers } from '../layers/AnnotationLayer'
import { buildGeofenceLayers, type GeofenceItem } from '../layers/buildGeofenceLayers'
import { buildObservationRingLayers } from '../layers/buildObservationRingLayer'
import { buildCustomLayers } from '../layers/buildCustomLayers'
import { buildLightningLayer } from '../layers/buildLightningLayer'
import { buildStreamGaugeLayers, type StreamGaugePoint } from '../layers/buildStreamGaugeLayer'
import { buildMeshNodeLayers, type MeshNodePoint } from '../layers/buildMeshNodeLayer'
import { buildDispatchLayers } from '../layers/buildDispatchLayer'
import { buildReplayTracks } from '../layers/replayTracks'
import type { RadioIncident } from '../storeTypes'
import { isSupplementSource } from '../storeTypes'

import { extractRailSegments, snapPointToRail, type RailSegment } from '../layers/railSnap'
import { fetchRailGeoJSON } from '../layers/railData'
import { applyPVB, applyPVBTrack, type PVBState } from '../layers/pvb'
import { smoothTransitPosition, type TransitMotionState } from '../layers/transitMotion'
import { projectTransit, type TransitProjectionState } from '../layers/transitProjection'
import { buildTransitRouteLayers, type TransitRoute } from '../layers/transitRouteLayer'
import { DEFAULT_CENTER, OBSERVATION_RANGE_KM, API_BASE } from '../config'
import { authHeaders } from '../auth'
import type { LightningStrike } from '../store'
import { installPerfRecorder, markLayerBuild } from '../perfRecorder'
import { isPerfEnabled, markPhase, registerDevMap, setScene } from '../devtools/devState'

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

const EMPTY_CAMERAS: TrafficCamera[] = []
const EMPTY_LIGHTNING: LightningStrike[] = []

export function MapOverlay({ map }: Props) {
  const deckRef           = useRef<MapboxOverlay | null>(null)
  // Per-group layer cache so static/slow-changing layers are rebuilt only when
  // their inputs change instead of on every animation frame. Reusing the same
  // Layer instances lets deck.gl skip re-diffing them entirely.
  const layerMemoRef      = useRef(new MapLayerCache())
  const entitiesRef       = useRef<Record<string, Entity>>({})
  const typeVersionRef    = useRef<Record<string, number>>({})
  const tracksRef         = useRef<Record<string, Track>>({})
  const pvbRef            = useRef<Record<string, PVBState>>({})
  const transitMotionRef  = useRef<Record<string, TransitMotionState>>({})
  const transitProjectionRef = useRef<Record<string, TransitProjectionState>>({})
  const selectedTransitRouteRef = useRef<TransitRoute | null>(null)
  const selectedRef       = useRef<string | null>(null)
  const camerasRef        = useRef<TrafficCamera[]>([])
  const selectedCamRef    = useRef<string | null>(null)
  const activeTabRef      = useRef<string>('safety')
  const entityFilterRef   = useRef<EntityTypeFilter>({ aircraft: true, adsbLocal: true, adsbSupplement: true, vessel: true, mesh_node: true, aprs: true, fire_incident: true, satellite: true, rf_sensor: true, train: true, bus: true })
  const subFiltersRef     = useRef<SubFilters>({})
  const searchQueryRef    = useRef<string>('')
  const altRangeRef       = useRef<RangeFilter>([0, 60_000])
  const speedRangeRef     = useRef<RangeFilter>([0, 600])
  const replayModeRef     = useRef<boolean>(false)
  const replayDataRef     = useRef<ReplayData | null>(null)
  const replayTsRef       = useRef<number>(0)
  const cycleRef          = useRef(0)
  const rafRef            = useRef(0)

  // Keep refs in sync — no loop restart on state change
  const selectedId       = useCivicStore((s) => s.selectedEntityId)
  const cameras          = useCivicStore((s) => s.camerasVisible ? s.cameras : EMPTY_CAMERAS)
  const selectedCamId    = useCivicStore((s) => s.selectedCamId)
  const camerasVisible   = useCivicStore((s) => s.camerasVisible)
  const activeTab        = useCivicStore((s) => s.activeTab)
  const entityFilter      = useCivicStore((s) => s.entityFilter)
  const subFilters        = useCivicStore((s) => s.subFilters)
  const entitySearchQuery = useCivicStore((s) => s.entitySearchQuery)
  const entityAltRange    = useCivicStore((s) => s.entityAltRange)
  const entitySpeedRange  = useCivicStore((s) => s.entitySpeedRange)
  const replayMode        = useCivicStore((s) => s.replayMode)
  const replayData        = useCivicStore((s) => s.replayData)
  const replayCurrentTs   = useCivicStore((s) => s.replayCurrentTs)
  const systemEvents      = useCivicStore((s) => s.systemEvents)
  const entityMissionTags = useCivicStore((s) => s.entityMissionTags)
  const lightningStrikes   = useCivicStore((s) => s.lightningVisible ? s.lightningStrikes : EMPTY_LIGHTNING)
  const lightningVisible   = useCivicStore((s) => s.lightningVisible)
  const gaugesVisible      = useCivicStore((s) => s.gaugesVisible)
  const selectEntity      = useCivicStore((s) => s.selectEntity)
  const setSelectedCamId  = useCivicStore((s) => s.setSelectedCamId)
  const radioIncidents     = useCivicStore((s) => s.dispatchVisible ? s.radioIncidents : null)
  const dispatchVisible    = useCivicStore((s) => s.dispatchVisible)
  const setFocusIncidentId = useCivicStore((s) => s.setFocusIncidentId)
  const setActiveTab      = useCivicStore((s) => s.setActiveTab)
  const geofencesVisible  = useCivicStore((s) => s.geofencesVisible)
  const trailsVisible     = useCivicStore((s) => s.trailsVisible)
  const annotations       = useCivicStore((s) => s.annotations)
  const annotationsVisible = useCivicStore((s) => s.annotationsVisible)
  const customLayers      = useCivicStore((s) => s.customLayers)
  const annotationDrawMode = useCivicStore((s) => s.annotationDrawMode)
  const annotationDrawModeRef = useRef<'marker' | 'line' | 'polygon' | null>(null)
  useEffect(() => { annotationDrawModeRef.current = annotationDrawMode }, [annotationDrawMode])
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
  useEffect(() => { selectedRef.current = selectedId            }, [selectedId])
  useEffect(() => { camerasRef.current = cameras                }, [cameras])
  useEffect(() => { selectedCamRef.current = selectedCamId      }, [selectedCamId])
  useEffect(() => { entityFilterRef.current = entityFilter      }, [entityFilter])
  useEffect(() => { subFiltersRef.current = subFilters          }, [subFilters])
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
  const dispatchRef = useRef<RadioIncident[]>([])
  const dispatchVisibleRef = useRef(true)
  useEffect(() => { dispatchRef.current = radioIncidents?.incidents ?? [] }, [radioIncidents])
  useEffect(() => { dispatchVisibleRef.current = dispatchVisible }, [dispatchVisible])
  useEffect(() => { gaugesVisibleRef.current = gaugesVisible }, [gaugesVisible])
  useEffect(() => { lightningRef.current = lightningStrikes }, [lightningStrikes])
  useEffect(() => { lightningVisibleRef.current = lightningVisible }, [lightningVisible])
  const camerasVisibleRef = useRef(false)
  useEffect(() => { camerasVisibleRef.current = camerasVisible  }, [camerasVisible])
  useEffect(() => { activeTabRef.current = activeTab            }, [activeTab])
  // High-frequency reports update refs directly, without a React commit.
  useEffect(() => {
    const sync = (state: ReturnType<typeof useCivicStore.getState>) => {
      tracksRef.current = state.tracks
      entitiesRef.current = state.entities
      typeVersionRef.current = state.entityTypeVersion
    }
    sync(useCivicStore.getState())
    return useCivicStore.subscribe(sync)
  }, [])
  const selectedFeed = useCivicStore(s => s.entities[s.selectedEntityId ?? '']?.identity?.feed)
  const selectedShape = useCivicStore(s => s.entities[s.selectedEntityId ?? '']?.identity?.shape_id)
  const selectedVehicleType = useCivicStore(s => s.entities[s.selectedEntityId ?? '']?.entity_type)
  const selectedTransitVisible = selectedVehicleType === 'bus' ? entityFilter.bus
    : selectedVehicleType === 'train' && entityFilter.train
  useEffect(() => {
    let cancelled = false
    selectedTransitRouteRef.current = null
    if (!selectedTransitVisible) return
    const controller = new AbortController()
    if (typeof selectedFeed === 'string' && typeof selectedShape === 'string' && selectedShape) {
      const load = async () => {
        try {
          const url = `${API_BASE}/transit/trip-shape/${encodeURIComponent(selectedFeed)}/${encodeURIComponent(selectedShape)}`
          const response = await fetch(url, { headers: authHeaders(), signal: controller.signal })
          if (!response.ok) return
          const geometry = await response.json() as { type?: string; coordinates?: unknown }
          if (cancelled || geometry.type !== 'MultiLineString' || !Array.isArray(geometry.coordinates)) return
          const lines = (geometry.coordinates as unknown[]).filter((line): line is [number, number][] =>
            Array.isArray(line) && line.length >= 2 && line.every(p => Array.isArray(p) && p.length === 2
              && p.every(v => typeof v === 'number' && Number.isFinite(v))))
          selectedTransitRouteRef.current = { type: selectedVehicleType === 'bus' ? 'bus' : 'train', lines }
        } catch { /* source shape unavailable */ }
      }
      load()
    }
    return () => { cancelled = true; controller.abort(); selectedTransitRouteRef.current = null }
  }, [selectedId, selectedFeed, selectedShape, selectedVehicleType, selectedTransitVisible])
  const geofencesVisibleRef = useRef(true)
  useEffect(() => { geofencesVisibleRef.current = geofencesVisible }, [geofencesVisible])
  const trailsVisibleRef = useRef(true)
  useEffect(() => { trailsVisibleRef.current = trailsVisible }, [trailsVisible])
  useEffect(() => {
    if (!geofencesVisible) return
    let cancelled = false
    const controller = new AbortController()
    const loadGeofences = async () => {
      try {
        const res = await fetch(`${API_BASE}/geofences`, { headers: authHeaders(), signal: controller.signal })
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
      controller.abort()
    }
  }, [geofencesVisible])

  useEffect(() => {
    if (!entityFilter.train) return
    let cancelled = false

    const loadRailSegments = async () => {
      try {
        const geojson = await fetchRailGeoJSON('tracks')
        if (!geojson || cancelled) return
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
  }, [entityFilter.train])

  useEffect(() => {
    if (!gaugesVisible) return
    let cancelled = false
    const controller = new AbortController()

    const loadGaugeFallback = async () => {
      // Live gauges arrive over the WebSocket; only poll REST until they do.
      // Dropping the fallback also stops it churning the gauge layer memo.
      const entities = useCivicStore.getState().entities
      if (Object.values(entities).some((e) => e.entity_type === 'stream_gauge')) {
        if (gaugeFallbackRef.current.length > 0) gaugeFallbackRef.current = []
        return
      }
      try {
        const res = await fetch(`${API_BASE}/entities?entity_type=stream_gauge`, {
          headers: authHeaders(), signal: controller.signal,
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
      controller.abort()
    }
  }, [gaugesVisible])
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

    // Render Deck.gl through MapLibre's own render loop via MapboxOverlay. Unlike
    // a standalone Deck on a separate canvas synced by pushing viewState each rAF
    // (which leaves the two canvases a frame out of phase, so icons "jiggle"/swim
    // during pan & zoom), the overlay redraws in lockstep with the base map, so
    // entities stay glued to the ground. MapLibre still owns all user input.
    const overlay = new MapboxOverlay({
      id:          'deck-overlay-canvas',  // keeps snapshotExport's canvas lookup working
      interleaved: false,
      parameters: { depthCompare: 'always', depthWriteEnabled: false },
      layers:      [],
    })
    map.addControl(overlay as unknown as maplibregl.IControl)
    deckRef.current = overlay

    // Unified SA Tooltip Bridge
    const tooltip = document.createElement('div')
    tooltip.className = 'absolute pointer-events-none z-[100] opacity-0 transition-opacity duration-150'
    container.appendChild(tooltip)

    // Deck picking is a GPU readback — throttle it so fast mouse movement
    // doesn't stall the render loop. Between picks the tooltip just tracks
    // the cursor.
    const PICK_INTERVAL_MS = 50
    let lastPickMs = 0

    const onMapMouseMove = (e: maplibregl.MapMouseEvent) => {
      const isMobileViewport = window.innerWidth < 1024
      if (isMobileViewport) {
        tooltip.style.opacity = '0'
        map.getCanvas().style.cursor = ''
        return
      }

      const nowMs = performance.now()
      if (nowMs - lastPickMs < PICK_INTERVAL_MS) {
        if (tooltip.style.opacity === '1') {
          tooltip.style.left = `${e.point.x + 15}px`
          tooltip.style.top = `${e.point.y + 15}px`
        }
        return
      }
      lastPickMs = nowMs

      // 1. Pick from Deck.gl (returns null until the overlay GL context is ready)
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 5 })

      let html = ''

      if (picked?.object && picked.layer) {
        const { object, layer } = picked
        if (layer.id.startsWith('entity-icons::')) {
          const t = object as Track
          const isTak = t.type === 'tak' || t.source.toLowerCase().includes('tak')
          if (isTak && isMobileViewport) {
            tooltip.style.opacity = '0'
            map.getCanvas().style.cursor = ''
            return
          }
          const isAir    = t.type === 'air'
          const isRail   = t.type === 'rail'
          const isBus    = t.type === 'bus'
          const isGround = t.type === 'ground'
          const isHazard = t.type === 'hazard'
          const ALT_M_TO_FT = 3.28084
          const MS_TO_KT    = 1.94384

          const tooltipIcon = isAir ? 'flight'
            : isRail ? 'directions_railway'
            : isBus ? 'directions_bus'
            : isGround ? 'sensors'
            : isHazard ? 'local_fire_department'
            : 'sailing'

          const tooltipColor = isAir ? 'text-cyan-adsb'
            : isRail ? 'text-amber-gold'
            : isBus ? 'text-transit-bus'
            : isGround ? 'text-on-surface-variant'
            : isHazard ? 'text-red-emergency'
            : 'text-green-ais'

          const sourceLabel = isAir ? (isSupplementSource(t.source) ? 'ADS-B · Network' : 'ADS-B · Local')
            : isRail ? escHtml(t.source.toUpperCase())
            : isBus ? escHtml(t.source.toUpperCase())
            : isGround ? 'APRS'
            : isHazard ? 'INTEL'
            : 'AIS'

          const statusLabel = isAir ? (t.positionDr ? 'Estimated' : t.positionStale ? 'Stale fix' : 'Fresh fix')
            : isRail ? 'En Route'
            : isBus ? 'On Route'
            : isGround ? 'Station'
            : isHazard ? 'Active'
            : t.vesselStationary ? 'Stationary' : t.positionStale ? 'Stale report' : 'Recent report'
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading-block">
                <div class="flex items-start gap-2">
                  <span class="ms shrink-0 text-[16px] ${tooltipColor}">${tooltipIcon}</span>
                  <span class="min-w-0 font-mono font-bold text-on-surface uppercase tracking-wider text-[11px] break-all">${escHtml(t.callsign || t.uid)}</span>
                </div>
                <div class="mt-1 pl-6 text-[11px] text-on-surface-variant font-mono break-words">${sourceLabel}</div>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-on-surface-variant font-mono">
                 ${isAir ? `<span>ALT:</span><span class="text-on-surface text-right">${Math.round(t.altMeters * ALT_M_TO_FT).toLocaleString()} FT</span>` : ''}
                 <span>SPD:</span><span class="text-on-surface text-right">${t.transitSpeedInferred ? '~' : ''}${isBus ? `${Math.round(t.speedMs * 2.23694)} MPH` : `${Math.round(t.speedMs * MS_TO_KT)} KTS`}</span>
                 <span>${t.type === 'sea' ? 'COG' : 'HDG'}:</span><span class="text-on-surface text-right">${t.type !== 'sea' || t.vesselCourseKnown ? `${Math.round(t.courseTrue).toString().padStart(3, '0')}°` : '--'}</span>
                 ${t.vesselHeading != null ? `<span>BOW:</span><span class="text-on-surface text-right">${Math.round(t.vesselHeading)}°</span>` : ''}
                 ${t.type === 'sea' && !t.positionStale && t.vesselCourseKnown && !t.vesselStationary && t.speedMs >= 0.5 ? '<span class="col-span-2 text-green-ais">Short course-based projection</span>' : ''}
                 ${t.transitDestination ? `<span>DEST:</span><span class="text-on-surface text-right truncate">${escHtml(t.transitDestination.slice(0, 80))}</span>` : ''}
                 ${t.positionDr && t.transitMotionPath ? '<span class="col-span-2 text-transit-bus">Projected along published route</span>' : ''}
                 ${t.category ? `<span>CAT:</span><span class="text-amber-gold text-right uppercase">${escHtml(t.category)}</span>` : ''}
              </div>
              <div class="mt-2 pt-1 border-t border-outline-variant text-[11px] text-on-surface-variant font-mono flex flex-wrap gap-x-3 gap-y-1 justify-between uppercase">
                <span>ID: ${escHtml(t.uid.slice(0, 8))}</span>
                <span>${statusLabel}</span>
              </div>
            </div>
          `
        } else if (layer.id === 'camera-points') {
          const cam = object as TrafficCamera
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                 <span class="ms shrink-0 text-[16px] text-amber-gold">videocam</span>
                 <span class="min-w-0 break-words">${escHtml(cam.name)}</span>
              </div>
              <div class="space-y-1">
                ${cam.road ? `<div class="text-[11px] text-on-surface flex items-center gap-1.5"><span class="ms text-[12px] text-on-surface-variant">add_road</span> ${escHtml(cam.road)}</div>` : ''}
                <div class="text-[11px] text-on-surface-variant font-mono flex flex-wrap gap-x-3 gap-y-1 justify-between">
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

          let color = 'text-on-surface-variant'
          if (ev.severity === 'high') color = 'text-red-emergency'
          else if (ev.severity === 'medium') color = 'text-amber-gold'
          else if (ev.severity === 'low') color = 'text-on-surface-variant'

          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                 <span class="ms shrink-0 text-[16px] ${color}">crisis_alert</span>
                 <span class="min-w-0 break-words uppercase">${escHtml(ev.event_type)}</span>
              </div>
              <div class="space-y-1">
                <div class="text-[11px] text-on-surface">${escHtml(ev.summary)}</div>
                <div class="text-[11px] text-on-surface-variant font-mono flex flex-wrap gap-x-3 gap-y-1 justify-between mt-1 pt-1 border-t border-outline-variant">
                  <span class="uppercase">${escHtml(ev.severity)}</span>
                  <span>${ageStr}</span>
                </div>
              </div>
            </div>
          `
        } else if (layer.id === 'dispatch-incidents') {
          const inc = object as RadioIncident
          const mins = Math.max(0, Math.round((Date.now() - Date.parse(inc.last_seen)) / 60_000))
          const ago = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
          const label = inc.nature ?? inc.category.replace(/_/g, ' ')
          const tone = inc.severity >= 5 ? 'text-red-emergency' : 'text-amber-p25'
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                <span class="ms shrink-0 text-[16px] ${tone}">cell_tower</span>
                <span class="min-w-0 break-words">${escHtml(label)}</span>
              </div>
              <div class="text-[12px] text-on-surface">${escHtml(inc.location ?? 'Location not stated')}${inc.city ? `<span class="text-on-surface-variant"> · ${escHtml(inc.city)}</span>` : ''}</div>
              ${inc.unit_summary ? `<div class="text-[11px] text-amber-p25 font-mono mt-0.5">${escHtml(inc.unit_summary)}</div>` : ''}
              ${inc.markers?.length ? `<div class="text-[11px] text-red-emergency mt-0.5">${escHtml(inc.markers.join(' · '))}</div>` : ''}
              <div class="text-[11px] text-on-surface-variant font-mono mt-1 flex justify-between"><span>${inc.call_count} call${inc.call_count === 1 ? '' : 's'}</span><span>${ago}</span></div>
              <div class="text-[10px] text-on-surface-variant mt-1">Click to open on the Incidents page</div>
            </div>
          `
        } else if (layer.id === 'stream-gauge-dots') {
          const gauge = object as StreamGaugePoint
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                <span class="ms shrink-0 text-[16px] text-on-surface-variant">waves</span>
                <span class="min-w-0 break-words">${escHtml(gauge.name)}</span>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-on-surface-variant font-mono">
                <span>STAGE:</span><span class="text-right text-on-surface uppercase">${escHtml(gauge.stage)}</span>
                <span>FLOW:</span><span class="text-right text-on-surface">${gauge.flow_cfs !== null ? `${Math.round(gauge.flow_cfs)} cfs` : 'n/a'}</span>
                <span>HEIGHT:</span><span class="text-right text-on-surface">${gauge.height_ft !== null ? `${gauge.height_ft.toFixed(1)} ft` : 'n/a'}</span>
              </div>
            </div>
          `
        } else if (layer.id === 'mesh-node-dots') {
          const node = object as MeshNodePoint
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                <span class="ms shrink-0 text-[16px] ${node.stale ? 'text-on-surface-variant' : 'text-green-ais'}">hub</span>
                <span class="min-w-0 break-words">${escHtml(node.name)}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full ${node.stale ? 'bg-outline-variant' : 'bg-green-ais pulse-fast'}"></div>
                <div class="text-[11px] text-on-surface-variant font-mono">${node.stale ? 'STALE / OFFLINE' : 'ACTIVE / ONLINE'}</div>
              </div>
              ${node.status ? `<div class="text-[11px] text-on-surface-variant font-mono mt-1">${escHtml(node.status)}</div>` : ''}
            </div>
          `
        } else if (layer.id === 'geofence-fill') {
          const geofence = object as GeofenceItem
          html = `
            <div class="map-tooltip-card">
              <div class="map-tooltip-heading">
                <span class="ms shrink-0 text-[16px] text-on-surface-variant">verified_user</span>
                <span class="min-w-0 break-words">${escHtml(geofence.name)}</span>
              </div>
              <div class="text-[11px] text-on-surface-variant font-mono uppercase tracking-tighter">${escHtml(geofence.zone_type)} Zone</div>
            </div>
          `
        } else if (layer.id.startsWith('custom-')) {
          html = `
            <div class="map-tooltip-card">
              <div class="text-[11px] text-on-surface-variant font-mono">Custom layer</div>
            </div>
          `
        }
      }

      if (html) {
        tooltip.innerHTML = html
        tooltip.style.opacity = '1'
        const left = e.point.x + 15 + tooltip.offsetWidth <= container.clientWidth - 8
          ? e.point.x + 15 : e.point.x - tooltip.offsetWidth - 15
        const top = e.point.y + 15 + tooltip.offsetHeight <= container.clientHeight - 8
          ? e.point.y + 15 : e.point.y - tooltip.offsetHeight - 15
        tooltip.style.left = `${Math.max(8, left)}px`
        tooltip.style.top = `${Math.max(8, top)}px`
        map.getCanvas().style.cursor = 'pointer'
      } else {
        tooltip.style.opacity = '0'
        map.getCanvas().style.cursor = ''
      }
    }

    // MapLibre's canvas-level leave event is 'mouseout' — 'mouseleave' only
    // fires for the layer-id overload and would never trigger here.
    const onMapMouseOut = () => {
      tooltip.style.opacity = '0'
      map.getCanvas().style.cursor = ''
    }
    map.on('mousemove', onMapMouseMove)
    map.on('mouseout', onMapMouseOut)

    // Allow selecting entities and cameras while preserving normal map interaction.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (annotationDrawModeRef.current) return
      const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 10 })
      if (!picked) return
      if (picked.layer?.id === 'camera-points') {
        const cam = picked.object as TrafficCamera
        setSelectedCamId(cam.id)
      } else if (picked.layer?.id === 'dispatch-incidents') {
        const inc = picked.object as RadioIncident | undefined
        if (inc) { setFocusIncidentId(inc.id); setActiveTab('incidents') }
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

    let last = performance.now()
    let lastLayerBuild = 0
    // rAF fires every ~16.7ms, so anything <= 16 here is a no-op throttle.
    // 33ms rebuilds layers at ~30fps — half the filter/PVB/layer-construction
    // work per second, and PVB keeps icon motion smooth between rebuilds while
    // MapLibre still pans/zooms the drawn frame at full 60fps.
    const LAYER_BUILD_INTERVAL_MS = 33

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
      transitMotionRef.current = {}
      transitProjectionRef.current = {}
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Rebuild a layer group only when its inputs change; otherwise reuse the
    // cached Layer instances so deck.gl skips re-diffing them on frames where
    // only the animated entity/trail layers actually moved.
    const memo = layerMemoRef.current
    const memoGroup = (name: string, deps: unknown[], build: () => Layer[]): Layer[] =>
      memo.get(name, deps, build)
    const visibleTracks = new VisibleTrackCache()
    let lastSubmittedLayers: Layer[] = []
    let lastCleanupTracks: Record<string, Track> | null = null

    // Opt-in frame profiling (Developer tools, ?debug=perf, or localStorage.vertexPerf = '1'): per-phase CPU time and
    // a scene snapshot feed the Frames, Tests and Scene tabs. isPerfEnabled() is re-read on every rebuild, so the
    // tools can be switched on and off without remounting the map.
    let perfOn = isPerfEnabled()
    const perfMark = markPhase
    let lastScenePublish = 0
    registerDevMap(map)
    const removePerfRecorder = installPerfRecorder()

    const tick = (now: number) => {
      // Clamp dt so a paused/throttled rAF can't fast-forward the pulse phase.
      const dt = Math.min(now - last, 100)
      last = now
      cycleRef.current = (cycleRef.current + dt / 2000) % 1  // 2-second pulse

      // No per-frame viewState push: MapboxOverlay tracks the base map's camera
      // automatically and redraws in lockstep with it.

      const shouldRebuildLayers = (now - lastLayerBuild >= LAYER_BUILD_INTERVAL_MS)
      if (!shouldRebuildLayers) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      lastLayerBuild = now
      perfOn = isPerfEnabled()
      const tFrame = perfOn ? performance.now() : 0
      let tPhase = tFrame

      const pvb = pvbRef.current
      if (replayModeRef.current) {
        transitMotionRef.current = {}
        transitProjectionRef.current = {}
      }
      const sel = selectedRef.current
      const nowMs = Date.now()

      const allTracks = replayModeRef.current && replayDataRef.current
        ? memo.get('replayTracks', [replayDataRef.current, replayTsRef.current],
            () => buildReplayTracks(replayDataRef.current!, replayTsRef.current))
        : tracksRef.current
      const rawTracks = visibleTracks.get(allTracks, entityFilterRef.current,
        searchQueryRef.current, altRangeRef.current, speedRangeRef.current, subFiltersRef.current)
      const animated = memo.get('animated', [rawTracks, sel, replayModeRef.current], () =>
        Boolean(sel && rawTracks[sel]) || Object.values(rawTracks).some(track =>
          track.alert || (track.type === 'ground' && track.stationType === 'emergency') ||
          (!replayModeRef.current && (track.type === 'air' || track.type === 'sea' ||
            track.speedMs >= 0.5 || track.source.startsWith('gtfs_')))))

      if (perfOn) { perfMark('filter', tPhase); tPhase = performance.now() }

      // Project each track forward from both the last server report and the last
      // visual position, then blend between them (Projective Velocity Blending).
      // Trail history stays raw on the Track object; the render-time lon/lat used by
      // trail-adjacent layers should match the icon position so stale BEAST tracks
      // do not visually detach from their own trail endpoint.
      // In replay mode, PVB is bypassed (positions already interpolated).
      const pvbTracks: Record<string, Track> = animated ? {} : rawTracks
      const railSegments = railSegmentsRef.current
      const railSnapCache = railSnapCacheRef.current
      if (animated) for (const uid of Object.keys(rawTracks)) {
        const track = rawTracks[uid] as Track

        // Rail snapping is expensive against large OSM segment sets. Cache snap
        // results per raw report and only recompute when the server position updates.
        let snappedBase = track
        if (track.type === 'rail' && !track.transitMotionPath && railSegments.length > 0) {
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

        // Follow the published trip shape between recent measured fixes; fall
        // back to a short fix-to-fix transition when the trip has no safe match.
        if (!replayModeRef.current && (snappedBase.type === 'rail' || snappedBase.type === 'bus')
            && snappedBase.source.startsWith('gtfs_')) {
          const previousProjection = transitProjectionRef.current[uid]
          const previousMotion = transitMotionRef.current[uid]
          const initial = !previousProjection && previousMotion
            ? smoothTransitPosition(snappedBase, previousMotion, now) : undefined
          const projected = projectTransit(snappedBase, nowMs, previousProjection, initial)
          if (projected) {
            transitProjectionRef.current[uid] = projected.state
            delete transitMotionRef.current[uid]
            pvbTracks[uid] = projected.track
          } else {
            delete transitProjectionRef.current[uid]
            const handoff = previousProjection ? {
              fromLon: previousProjection.shownLon, toLon: previousProjection.shownLon,
              fromLat: previousProjection.shownLat, toLat: previousProjection.shownLat,
              fromCourse: previousProjection.shownCourse, toCourse: previousProjection.shownCourse,
              startedAt: now,
            } : previousMotion
            const motion = smoothTransitPosition(snappedBase, handoff, now)
            transitMotionRef.current[uid] = motion.state
            pvbTracks[uid] = motion.lon === snappedBase.lon && motion.lat === snappedBase.lat
              && motion.courseTrue === snappedBase.courseTrue
              ? snappedBase : { ...snappedBase, lon: motion.lon, lat: motion.lat, courseTrue: motion.courseTrue }
          }
        } else if (replayModeRef.current || snappedBase.type === 'rail' || snappedBase.type === 'bus') {
          pvbTracks[uid] = snappedBase
        } else {
          if (snappedBase.type === 'air' || snappedBase.type === 'sea') {
            pvbTracks[uid] = applyPVBTrack(pvb, snappedBase, nowMs)
          } else {
            const [lon, lat] = applyPVB(pvb, snappedBase, nowMs)
            pvbTracks[uid] = { ...snappedBase, lon, lat }
          }
        }
      }

      // Remove PVB state for tracks that have been purged.
      if (!replayModeRef.current && lastCleanupTracks !== tracksRef.current) {
        lastCleanupTracks = tracksRef.current
        const allTracks = tracksRef.current
        for (const uid of Object.keys(pvb)) {
          if (!(uid in allTracks)) delete pvb[uid]
        }
        for (const uid of Object.keys(railSnapCache)) {
          if (!(uid in allTracks)) delete railSnapCache[uid]
        }
        for (const uid of Object.keys(transitMotionRef.current)) {
          if (!(uid in allTracks)) delete transitMotionRef.current[uid]
        }
        for (const uid of Object.keys(transitProjectionRef.current)) {
          if (!(uid in allTracks)) delete transitProjectionRef.current[uid]
        }
      }

      if (perfOn) { perfMark('pvb', tPhase); tPhase = performance.now() }

      const zoom = map.getZoom()
      // Icon layers only change look at zoom 6 and 9: key them on the bucket so
      // a zoom animation doesn't rebuild ~1.3k mesh icons every frame.
      const zoomBucket = zoom >= 9 ? 9 : zoom >= 6 ? 6 : 0
      const entityZoom = zoom >= 10 ? 10 : zoomBucket
      const minuteBucket = Math.floor(nowMs / 60_000)  // mesh stale styling (hours-scale threshold)
      const typeVer = typeVersionRef.current
      const tv = terrainVersion()   // overlay positions follow the terrain: rebuild groups when it changes
      const timed = <T,>(name: string, fn: () => T): T => {
        if (!perfOn) return fn()
        const t0 = performance.now(); const out = fn(); perfMark(name, t0); return out
      }
      const layers = [
          ...memoGroup('custom', [customLayersRef.current],
            () => buildCustomLayers(customLayersRef.current)),
          ...memoGroup('geofence', [geofencesRef.current, geofencesVisibleRef.current],
            () => buildGeofenceLayers(geofencesRef.current, geofencesVisibleRef.current)),
          ...memoGroup('obsRing', [],
            () => buildObservationRingLayers(DEFAULT_CENTER, OBSERVATION_RANGE_KM, true)),
          // Rebuilt only when mesh nodes change (not on every aircraft update).
          ...memoGroup('mesh', [typeVer.mesh_node, entityFilterRef.current.mesh_node, subFiltersRef.current, zoomBucket, minuteBucket, tv],
            () => !entityFilterRef.current.mesh_node ? [] : timed('mesh', () => buildMeshNodeLayers(
              memo.get('meshData', [typeVer.mesh_node, subFiltersRef.current], () => Object.values(entitiesRef.current).filter(e => e.entity_type === 'mesh_node' && meshPassesFacets(e, subFiltersRef.current))),
              entityFilterRef.current.mesh_node,
              nowMs,
              zoomBucket,
              minuteBucket,
            ))),
          ...memoGroup('gauge', [typeVer.stream_gauge, gaugeFallbackRef.current, gaugesVisibleRef.current, zoomBucket, tv],
            () => {
              if (!gaugesVisibleRef.current) return []
              const wsGauges = memo.get('gaugeData', [typeVer.stream_gauge],
                () => Object.values(entitiesRef.current).filter(e => e.entity_type === 'stream_gauge'))
              const source = wsGauges.length > 0 ? wsGauges : gaugeFallbackRef.current
              return timed('gauge', () => buildStreamGaugeLayers(source, gaugesVisibleRef.current, zoomBucket))
            }),
          // Dynamic — rebuilt every frame for PVB motion / pulse animation.
          // Trail history only changes when a report arrives: cache it on the
          // track store + filters instead of re-tessellating every path each frame.
          ...memoGroup('trailHistory', [
            rawTracks, sel, trailsVisibleRef.current, tv,
          ], () => timed('trails', () => buildTrailLayers(rawTracks, sel, trailsVisibleRef.current, 'history'))),
          ...memoGroup('trailDynamic', [pvbTracks, sel, trailsVisibleRef.current, tv],
            () => timed('trailsDyn', () => buildTrailLayers(pvbTracks, sel, trailsVisibleRef.current, 'dynamic'))),
          ...memoGroup('trailSelected', [
            rawTracks, sel, trailsVisibleRef.current, tv,
          ], () => buildTrailLayers(rawTracks, sel, trailsVisibleRef.current, 'selected')),
          ...memoGroup('selectedTransitRoute', [selectedTransitRouteRef.current, rawTracks[sel ?? ''], replayModeRef.current],
            () => replayModeRef.current || !rawTracks[sel ?? ''] ? [] : buildTransitRouteLayers(selectedTransitRouteRef.current)),
          ...memoGroup('dispatch', [dispatchRef.current, dispatchVisibleRef.current, minuteBucket, zoom >= 8, tv],
            () => buildDispatchLayers(dispatchRef.current, dispatchVisibleRef.current, nowMs, zoom)),
          ...memoGroup('entity', [pvbTracks, sel, animated ? cycleRef.current : 0, entityZoom, missionTagsRef.current, tv],
            () => timed('entities', () => buildEntityLayers(pvbTracks, sel, cycleRef.current, entityZoom, missionTagsRef.current))),
          ...memoGroup('event', [systemEventsRef.current, minuteBucket, tv],
            () => timed('events', () => buildEventLayers(systemEventsRef.current, nowMs))),
          ...memoGroup('lightning', [lightningVisibleRef.current, lightningRef.current, zoomBucket,
            lightningVisibleRef.current ? Math.floor(nowMs / 100) : 0, tv],
            () => lightningVisibleRef.current ? buildLightningLayer(lightningRef.current, nowMs, zoomBucket) : []),
          ...memoGroup('camera', [camerasVisibleRef.current, camerasRef.current, selectedCamRef.current, zoomBucket, tv],
            () => (camerasVisibleRef.current
              ? [buildCameraLayer(camerasRef.current, selectedCamRef.current, zoomBucket)]
              : [])),
          // Draw preview intentionally omitted: AnnotationOverlay owns the
          // interactive drawing UX and already renders the preview via its
          // MapLibre source — rendering it here too drew it twice.
          ...memoGroup('annotation', [annotationsRef.current, annotationsVisibleRef.current],
            () => buildAnnotationLayers(annotationsRef.current, annotationsVisibleRef.current)),
      ]

      if (perfOn) { perfMark('build', tPhase); tPhase = performance.now() }
      const orderedLayers = orderOperationalLayers(layers)
      if (orderedLayers.length !== lastSubmittedLayers.length ||
          orderedLayers.some((layer, i) => layer !== lastSubmittedLayers[i])) {
        overlay.setProps({ layers: orderedLayers })
        lastSubmittedLayers = orderedLayers
        markLayerBuild(now)
      }
      if (perfOn) {
        perfMark('setProps', tPhase)
        perfMark('frameTotal', tFrame)
        if (now - lastScenePublish >= 500) {
          lastScenePublish = now
          setScene({
            ts: Date.now(),
            tracks: Object.keys(pvbTracks).length,
            entities: Object.keys(entitiesRef.current).length,
            layers: orderedLayers.map((layer) => {
              const data = (layer.props as { data?: unknown }).data
              return { id: layer.id, count: Array.isArray(data) ? data.length : null }
            }),
          })
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      removePerfRecorder()
      registerDevMap(null)
      map.off('click', onMapClick)
      map.off('mousemove', onMapMouseMove)
      map.off('mouseout', onMapMouseOut)
      map.removeControl(overlay as unknown as maplibregl.IControl)
      tooltip.remove()
      layerMemoRef.current = new MapLayerCache()
      deckRef.current = null
      pvbRef.current = {}
      transitMotionRef.current = {}
      transitProjectionRef.current = {}
    }
  }, [map])

  return null
}
