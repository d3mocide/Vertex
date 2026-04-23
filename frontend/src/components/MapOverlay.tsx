import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Track, TrafficCamera } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { buildCameraLayer } from '../layers/buildCameraLayer'
import { applyPVB, type PVBState } from '../layers/pvb'

interface Props {
  map: maplibregl.Map
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
  const deckRef        = useRef<Deck | null>(null)
  const tracksRef      = useRef<Record<string, Track>>({})
  const pvbRef         = useRef<Record<string, PVBState>>({})
  const selectedRef    = useRef<string | null>(null)
  const camerasRef     = useRef<TrafficCamera[]>([])
  const selectedCamRef = useRef<string | null>(null)
  const activeTabRef   = useRef<string>('safety')
  const cycleRef       = useRef(0)
  const rafRef         = useRef(0)

  // Keep refs in sync — no loop restart on state change
  const tracks         = useCivicStore((s) => s.tracks)
  const selectedId     = useCivicStore((s) => s.selectedEntityId)
  const cameras        = useCivicStore((s) => s.cameras)
  const selectedCamId  = useCivicStore((s) => s.selectedCamId)
  const camerasVisible = useCivicStore((s) => s.camerasVisible)
  const activeTab      = useCivicStore((s) => s.activeTab)
  const selectEntity   = useCivicStore((s) => s.selectEntity)
  const setSelectedCamId = useCivicStore((s) => s.setSelectedCamId)
  const setActiveTab   = useCivicStore((s) => s.setActiveTab)
  useEffect(() => { tracksRef.current = tracks          }, [tracks])
  useEffect(() => { selectedRef.current = selectedId    }, [selectedId])
  useEffect(() => { camerasRef.current = cameras        }, [cameras])
  useEffect(() => { selectedCamRef.current = selectedCamId }, [selectedCamId])
  const camerasVisibleRef = useRef(false)
  useEffect(() => { camerasVisibleRef.current = camerasVisible }, [camerasVisible])
  useEffect(() => { activeTabRef.current = activeTab    }, [activeTab])

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

      const rawTracks = tracksRef.current
      const pvb       = pvbRef.current
      const sel       = selectedRef.current

      // Project each track forward from both the last server report and the last
      // visual position, then blend between them (Projective Velocity Blending).
      // Trail layers receive rawTracks (actual history); only icon positions are smoothed.
      const pvbTracks: Record<string, Track> = {}
      for (const uid of Object.keys(rawTracks)) {
        const track = rawTracks[uid] as Track
        const [lon, lat] = applyPVB(pvb, track, now)
        pvbTracks[uid] = (lon === track.lon && lat === track.lat)
          ? track
          : { ...track, lon, lat }
      }

      // Remove PVB state for tracks that have been purged from the store.
      for (const uid of Object.keys(pvb)) {
        if (!(uid in rawTracks)) delete pvb[uid]
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
