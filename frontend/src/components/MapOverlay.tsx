import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { useCivicStore } from '../store'
import type { Track } from '../store'
import { StencilClearLayer, buildEntityLayers } from '../layers/buildEntityLayers'
import { buildTrailLayers } from '../layers/buildTrailLayers'

interface Props {
  map: maplibregl.Map
}

export function MapOverlay({ map }: Props) {
  const overlayRef  = useRef<MapboxOverlay | null>(null)
  const tracksRef   = useRef<Record<string, Track>>({})
  const selectedRef = useRef<string | null>(null)
  const cycleRef    = useRef(0)
  const rafRef      = useRef(0)

  // Keep refs in sync with store — does not restart the rAF loop
  const tracks     = useCivicStore((s) => s.tracks)
  const selectedId = useCivicStore((s) => s.selectedEntityId)
  useEffect(() => { tracksRef.current = tracks    }, [tracks])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

  useEffect(() => {
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay

    let last = performance.now()

    const tick = (now: number) => {
      const dt = now - last
      last = now
      cycleRef.current = (cycleRef.current + dt / 2000) % 1  // 2s pulse period

      const t      = tracksRef.current
      const sel    = selectedRef.current
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globe  = ((map as any).getProjection?.() as { name?: string } | undefined)?.name === 'globe'

      overlay.setProps({
        layers: [
          new StencilClearLayer({ id: 'stencil-clear' }),
          ...buildTrailLayers(t, sel, globe),
          ...buildEntityLayers(t, sel, cycleRef.current, globe),
        ],
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      map.removeControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = null
    }
  }, [map])

  return null
}
