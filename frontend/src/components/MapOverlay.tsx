import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { Deck } from '@deck.gl/core'
import { useCivicStore } from '../store'
import type { Track } from '../store'
import { buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'

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

function isGlobeMode(map: maplibregl.Map): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((map as any).getProjection?.() as { name?: string } | undefined)?.name === 'globe'
}

export function MapOverlay({ map }: Props) {
  const deckRef     = useRef<Deck | null>(null)
  const tracksRef   = useRef<Record<string, Track>>({})
  const selectedRef = useRef<string | null>(null)
  const cycleRef    = useRef(0)
  const rafRef      = useRef(0)

  // Keep refs in sync — no loop restart on state change
  const tracks     = useCivicStore((s) => s.tracks)
  const selectedId = useCivicStore((s) => s.selectedEntityId)
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

    // Keep deck.gl view in sync with MapLibre camera
    const syncView = () => deck.setProps({ viewState: getViewState(map) })
    map.on('move', syncView)

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

      const t     = tracksRef.current
      const sel   = selectedRef.current
      const globe = isGlobeMode(map)

      deck.setProps({
        layers: [
          ...buildTrailLayers(t, sel, globe),
          ...buildEntityLayers(t, sel, cycleRef.current, globe),
        ],
      })

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      map.off('move', syncView)
      resizeObserver.disconnect()
      deck.finalize()
      canvas.remove()
      deckRef.current = null
    }
  }, [map])

  return null
}
