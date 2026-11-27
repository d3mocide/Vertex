import { createContext, useContext, useEffect, useLayoutEffect, type RefObject } from 'react'
import { getDevMap } from '../devtools/devState'

export interface MapViewportRect {
  top: number
  left: number
  width: number
  height: number
}

interface MapViewportContextValue {
  setSlotRect: (rect: MapViewportRect | null) => void
}

export const MapViewportContext = createContext<MapViewportContextValue>({
  setSlotRect: () => {},
})

function rectsClose(a: MapViewportRect | null, b: MapViewportRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    Math.abs(a.top - b.top) < 1 &&
    Math.abs(a.left - b.left) < 1 &&
    Math.abs(a.width - b.width) < 1 &&
    Math.abs(a.height - b.height) < 1
  )
}

/**
 * Bind a transparent layout slot to the single mounted `<Map />` instance.
 * While `active` is true, the root map wrapper tracks this element's screen
 * rectangle so Dashboard and Wall views share one WebGL context with zero
 * map re-initialization.
 */
export function useMapSlot(ref: RefObject<HTMLDivElement | null>, active: boolean): void {
  const { setSlotRect } = useContext(MapViewportContext)

  useLayoutEffect(() => {
    if (!active) {
      setSlotRect(null)
      return
    }
    const el = ref.current
    if (!el) return

    let rafId = 0
    let last: MapViewportRect | null = null

    const publish = () => {
      rafId = 0
      const target = ref.current
      if (!target) return
      const r = target.getBoundingClientRect()
      const next: MapViewportRect | null =
        r.width >= 40 && r.height >= 40
          ? {
              top: Math.round(r.top),
              left: Math.round(r.left),
              width: Math.round(r.width),
              height: Math.round(r.height),
            }
          : null
      if (!rectsClose(last, next)) {
        last = next
        setSlotRect(next)
      }
    }

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(publish)
    }

    publish()
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      setSlotRect(null)
    }
  }, [ref, active, setSlotRect])
}

/** Smoothly pan/zoom the single live MapLibre instance to a target coordinate. */
export function flyMapTo(lon: number, lat: number, minZoom = 11.5): void {
  const map = getDevMap()
  if (!map) return
  map.flyTo({
    center: [lon, lat],
    zoom: Math.max(map.getZoom(), minZoom),
    duration: 650,
  })
}

/** Reset the live map camera back to a given center/zoom. */
export function resetMapCamera(center: [number, number], zoom: number): void {
  const map = getDevMap()
  if (!map) return
  map.flyTo({ center, zoom, duration: 600 })
}

/** Trigger a resize on the live MapLibre instance after a container transition. */
export function useSyncMapResize(dep: unknown): void {
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      getDevMap()?.resize()
    })
    return () => cancelAnimationFrame(id)
  }, [dep])
}
