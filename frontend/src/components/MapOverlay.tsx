import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Track } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'
import { getDistanceMeters } from '../layers/geoUtils'

const SMOOTH_TAU_MS = 300
const SNAP_DISTANCE_M = 600

type AnimatedTrackState = {
  lon: number
  lat: number
}

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

function getAnimatedTracks(
  tracks: Record<string, Track>,
  dtMs: number,
  state: Record<string, AnimatedTrackState>,
): Record<string, Track> {
  const out: Record<string, Track> = {}

  const liveIds = new Set(Object.keys(tracks))
  for (const uid of Object.keys(state)) {
    if (!liveIds.has(uid)) delete state[uid]
  }

  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / SMOOTH_TAU_MS)

  for (const [uid, track] of Object.entries(tracks)) {
    const targetLon = track.lon
    const targetLat = track.lat

    if (!state[uid]) {
      state[uid] = { lon: targetLon, lat: targetLat }
    } else {
      const distM = getDistanceMeters(state[uid].lon, state[uid].lat, targetLon, targetLat)
      if (distM > SNAP_DISTANCE_M) {
        state[uid].lon = targetLon
        state[uid].lat = targetLat
      } else {
        state[uid].lon += (targetLon - state[uid].lon) * alpha
        state[uid].lat += (targetLat - state[uid].lat) * alpha
      }
    }

    out[uid] = {
      ...track,
      lon: state[uid].lon,
      lat: state[uid].lat,
    }
  }

  return out
}

export function MapOverlay({ map }: Props) {
  const deckRef     = useRef<Deck | null>(null)
  const tracksRef   = useRef<Record<string, Track>>({})
  const animatedStateRef = useRef<Record<string, AnimatedTrackState>>({})
  const selectedRef = useRef<string | null>(null)
  const cycleRef    = useRef(0)
  const rafRef      = useRef(0)

  // Keep refs in sync — no loop restart on state change
  const tracks     = useCivicStore((s) => s.tracks)
  const selectedId = useCivicStore((s) => s.selectedEntityId)
  const selectEntity = useCivicStore((s) => s.selectEntity)
  useEffect(() => { tracksRef.current = tracks     }, [tracks])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

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

    // Allow selecting deck.gl entity icons while preserving normal map interaction.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      const picked = deck.pickObject({ x: e.point.x, y: e.point.y, radius: 10 })
      const track = picked?.object as Track | undefined
      if (track?.uid) selectEntity(track.uid)
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
      const animatedTracks = getAnimatedTracks(rawTracks, dt, animatedStateRef.current)
      const sel = selectedRef.current

      deck.setProps({
        viewState: getViewState(map),
        layers: [
          ...buildTrailLayers(rawTracks, sel),
          ...buildEntityLayers(animatedTracks, sel, cycleRef.current),
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
      animatedStateRef.current = {}
    }
  }, [map])

  return null
}
