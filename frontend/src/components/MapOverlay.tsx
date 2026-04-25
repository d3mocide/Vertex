import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Track, TrafficCamera, EntityTypeFilter, RangeFilter, ReplayData } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { buildCameraLayer } from '../layers/buildCameraLayer'
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
  const entityFilterRef   = useRef<EntityTypeFilter>({ aircraft: true, vessel: true, mesh_node: true })
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
  const selectEntity      = useCivicStore((s) => s.selectEntity)
  const setSelectedCamId  = useCivicStore((s) => s.setSelectedCamId)
  const setActiveTab      = useCivicStore((s) => s.setActiveTab)
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
  const camerasVisibleRef = useRef(false)
  useEffect(() => { camerasVisibleRef.current = camerasVisible  }, [camerasVisible])
  useEffect(() => { activeTabRef.current = activeTab            }, [activeTab])

  useEffect(() => {
    const container = map.getContainer()

    // Overlay canvas: sits on top of the MapLibre canvas, passes events through.
    const canvas = document.createElement('canvas')
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

    // Allow selecting entities and cameras while preserving normal map interaction.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
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
          const isAir = track.type === 'air'
          if (isAir  && !ef.aircraft) continue
          if (!isAir && !ef.vessel)   continue

          if (q) {
            const name = (track.callsign ?? uid).toLowerCase()
            if (!name.includes(q) && !uid.toLowerCase().includes(q)) continue
          }

          const altFt = track.altMeters * ALT_M_TO_FT
          if (isAir && (altFt < minAlt || altFt > maxAlt)) continue

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
          ...buildEntityLayers(pvbTracks, sel, cycleRef.current),
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
      resizeObserver.disconnect()
      deck.finalize()
      canvas.remove()
      deckRef.current = null
      pvbRef.current = {}
    }
  }, [map])

  return null
}
