import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Track, TrafficCamera, EntityTypeFilter, RangeFilter, ReplayData, SystemEvent } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { buildCameraLayer } from '../layers/buildCameraLayer'
import { buildEventLayers } from '../layers/buildEventLayers'
import { applyPVB, type PVBState } from '../layers/pvb'

interface Props {
  map: maplibregl.Map
}

const ALT_FT_TO_M  = 0.3048
const SPD_KT_TO_MS = 0.5144

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

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
  const tracksRef         = useRef<Record<string, Track>>({})
  const pvbRef            = useRef<Record<string, PVBState>>({})
  const selectedRef       = useRef<string | null>(null)
  const camerasRef        = useRef<TrafficCamera[]>([])
  const selectedCamRef    = useRef<string | null>(null)
  const activeTabRef      = useRef<string>('safety')
  const entityFilterRef   = useRef<EntityTypeFilter>({ aircraft: true, vessel: true, mesh_node: true, aprs: true, fire_incident: true, satellite: true, tinygs_station: true })
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
  const selectEntity      = useCivicStore((s) => s.selectEntity)
  const setSelectedCamId  = useCivicStore((s) => s.setSelectedCamId)
  const setActiveTab      = useCivicStore((s) => s.setActiveTab)
  const geofencesVisible  = useCivicStore((s) => s.geofencesVisible)
  const annotationDrawMode = useCivicStore((s) => s.annotationDrawMode)
  const annotationDrawModeRef = useRef<'marker' | 'line' | 'polygon' | null>(null)
  useEffect(() => { annotationDrawModeRef.current = annotationDrawMode }, [annotationDrawMode])
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
  const camerasVisibleRef = useRef(false)
  useEffect(() => { camerasVisibleRef.current = camerasVisible  }, [camerasVisible])
  useEffect(() => { activeTabRef.current = activeTab            }, [activeTab])
  const geofencesVisibleRef = useRef(true)
  useEffect(() => { geofencesVisibleRef.current = geofencesVisible }, [geofencesVisible])
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
    const deck = new Deck({
      canvas,
      width:            container.clientWidth,
      height:           container.clientHeight,
      controller:       false,    // MapLibre owns all user input
      initialViewState: getViewState(map),
      layers:           [],
    })
    deckRef.current = deck

    // Unified SA Tooltip Bridge
    const tooltip = document.createElement('div')
    tooltip.className = 'absolute pointer-events-none z-[100] opacity-0 transition-opacity duration-150'
    container.appendChild(tooltip)

    const onMapMouseMove = (e: maplibregl.MapMouseEvent) => {
      // 1. Pick from Deck.gl
      const picked = deck.pickObject({ x: e.point.x, y: e.point.y, radius: 5 })
      
      // 2. Pick from MapLibre layers (Geofences, Mesh Nodes)
      // Filter to only layers that currently exist in the map style — querying
      // a non-existent layer throws synchronously in MapLibre.
      const candidateLayers = ['mesh-node-points', 'mesh-node-points-ring']
      if (geofencesVisibleRef.current) candidateLayers.push('geofences-fill')
      const layers = candidateLayers.filter((id) => !!map.getLayer(id))

      const mapHits = layers.length > 0
        ? map.queryRenderedFeatures(e.point, { layers })
        : []

      let html = ''
      
      if (picked?.object && picked.layer) {
        const { object, layer } = picked
        if (layer.id === 'entity-icons') {
          const t = object as Track
          const isAir = t.type === 'air'
          const ALT_M_TO_FT = 3.28084
          const MS_TO_KT    = 1.94384
          html = `
            <div class="p-2 min-w-[160px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center justify-between mb-2 border-b border-slate-700/50 pb-1.5">
                <div class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[16px] ${isAir ? 'text-blue-400' : 'text-teal-400'}">${isAir ? 'flight' : 'sailing'}</span>
                  <span class="font-bold text-white uppercase tracking-wider text-[11px] truncate">${t.callsign || t.uid}</span>
                </div>
                <span class="text-[9px] text-slate-500 font-mono">${isAir ? 'ADS-B' : 'AIS'}</span>
              </div>
              <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px] text-slate-400 font-mono">
                 ${isAir ? `<span>ALT:</span><span class="text-blue-200 text-right">${Math.round(t.altMeters * ALT_M_TO_FT).toLocaleString()} FT</span>` : ''}
                 <span>SPD:</span><span class="text-white text-right">${Math.round(t.speedMs * MS_TO_KT)} KTS</span>
                 <span>HDG:</span><span class="text-white text-right">${Math.round(t.courseTrue).toString().padStart(3, '0')}°</span>
                 ${t.category ? `<span>CAT:</span><span class="text-amber-400 text-right uppercase">${t.category}</span>` : ''}
              </div>
              <div class="mt-2 pt-1 border-t border-white/5 text-[9px] text-slate-500 flex justify-between uppercase">
                <span>ID: ${t.uid.slice(0, 8)}</span>
                <span>${isAir ? 'Airborne' : 'Underway'}</span>
              </div>
            </div>
          `
        } else if (layer.id === 'camera-points') {
          const cam = object as TrafficCamera
          html = `
            <div class="p-2 min-w-[180px] bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1.5">
                 <span class="material-symbols-outlined text-[16px] text-amber-400">videocam</span>
                 <span class="truncate">${cam.name}</span>
              </div>
              <div class="space-y-1">
                ${cam.road ? `<div class="text-[10px] text-slate-300 flex items-center gap-1.5"><span class="ms text-[12px] text-slate-500">add_road</span> ${cam.road}</div>` : ''}
                <div class="text-[10px] text-slate-400 italic flex justify-between">
                  <span>${cam.road ? 'Traffic Cam' : (cam as any).provider || 'Regional Network'}</span>
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
                 <span class="truncate uppercase">${ev.event_type}</span>
              </div>
              <div class="space-y-1">
                <div class="text-[10px] text-slate-300">${ev.summary}</div>
                <div class="text-[10px] text-slate-400 italic flex justify-between mt-1 pt-1 border-t border-slate-700/50">
                  <span class="uppercase">${ev.severity}</span>
                  <span>${ageStr}</span>
                </div>
              </div>
            </div>
          `
        }
      } else if (mapHits.length > 0) {
        const feature = mapHits[0]
        const props = feature.properties
        if (feature.layer.id === 'geofences-fill') {
          html = `
            <div class="p-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1">
                <span class="material-symbols-outlined text-[16px] text-blue-400">verified_user</span>
                <span>${props.name}</span>
              </div>
              <div class="text-[9px] text-slate-400 font-mono uppercase tracking-tighter">${props.zone_type} Zone</div>
            </div>
          `
        } else if (feature.layer.id.startsWith('mesh-node-points')) {
          const stale = props.stale === 'true' || props.stale === true
          html = `
            <div class="p-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md">
              <div class="flex items-center gap-2 text-[11px] font-bold text-white mb-1">
                <span class="material-symbols-outlined text-[16px] ${stale ? 'text-slate-500' : 'text-green-500'}">router</span>
                <span>${props.name}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full ${stale ? 'bg-slate-500' : 'bg-green-500 pulse-fast'}"></div>
                <div class="text-[9px] text-slate-400 font-mono">${stale ? 'STALE / OFFLINE' : 'ACTIVE / ONLINE'}</div>
              </div>
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
      const picked = deck.pickObject({ x: e.point.x, y: e.point.y, radius: 10 })
      if (!picked) return
      if (picked.layer?.id === 'camera-points') {
        const cam = picked.object as TrafficCamera
        setSelectedCamId(cam.id)
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
    const tick = (now: number) => {
      const dt = now - last
      last = now
      cycleRef.current = (cycleRef.current + dt / 2000) % 1  // 2-second pulse

      const pvb = pvbRef.current
      const sel = selectedRef.current

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
          if (track.type === 'sea' && !ef.vessel) continue
          if (track.type === 'ground' && !ef.aprs) continue
          if (track.type === 'hazard' && !ef.fire_incident) continue

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
      // Trail layers receive rawTracks (actual history); only icon positions are smoothed.
      // In replay mode, PVB is bypassed (positions already interpolated).
      const pvbTracks: Record<string, Track> = {}
      for (const uid of Object.keys(rawTracks)) {
        const track = rawTracks[uid] as Track
        if (replayModeRef.current) {
          pvbTracks[uid] = track
        } else {
          const [lon, lat] = applyPVB(pvb, track, now)
          pvbTracks[uid] = (lon === track.lon && lat === track.lat)
            ? track
            : { ...track, lon, lat }
        }
      }

      // Remove PVB state for tracks that have been purged.
      if (!replayModeRef.current) {
        const allTracks = tracksRef.current
        for (const uid of Object.keys(pvb)) {
          if (!(uid in allTracks)) delete pvb[uid]
        }
      }

      deck.setProps({
        viewState: getViewState(map),
        layers: [
          ...buildTrailLayers(rawTracks, sel),
          ...buildEntityLayers(pvbTracks, sel, cycleRef.current, missionTagsRef.current),
          ...buildEventLayers(systemEventsRef.current, now),
          ...(camerasVisibleRef.current
            ? [buildCameraLayer(camerasRef.current, selectedCamRef.current)]
            : []),
        ],
      })

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
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
