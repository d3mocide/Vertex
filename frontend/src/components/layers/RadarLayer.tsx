import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import {
  RADAR_FALLBACK_LAYER,
  RADAR_FALLBACK_MAX_ZOOM,
  RADAR_LAYER,
  RADAR_REFRESH_MS,
} from '../../config'

interface Props {
  map: maplibregl.Map
  forceVisible?: boolean
}

const SRC_LOCAL = 'nexrad-radar-local-src'
const SRC_WIDE = 'nexrad-radar-wide-src'
const LAYER_LOCAL = 'nexrad-radar-local-layer'
const LAYER_WIDE = 'nexrad-radar-wide-layer'
const CROSSFADE_MS = 350

// IEM NEXRAD layer — timestamp 0 resolves to the latest frame.
// The ?_= bust param prevents MapLibre's internal tile cache from serving stale
// tiles after a refresh cycle.
function tileUrl(layer: string, bust: number) {
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${layer}/{z}/{x}/{y}.png?_=${bust}`
}

function addRasterLayer(
  map: maplibregl.Map,
  sourceId: string,
  layerId: string,
  layerSlug: string,
  bust: number,
  opacity: number,
) {
  map.addSource(sourceId, {
    type: 'raster',
    tiles: [tileUrl(layerSlug, bust)],
    tileSize: 256,
    minzoom: 0,
    // Radar tiles are available above z8; allowing higher native zoom reduces
    // pixel-stretching when the map is viewed locally (default map zoom is 10).
    maxzoom: 11,
    attribution: '<a href="https://mesonet.agron.iastate.edu/" target="_blank">IEM NEXRAD</a>',
  })
  map.addLayer({
    id: layerId,
    type: 'raster',
    source: sourceId,
    paint: {
      'raster-opacity': opacity,
    },
  })
}

function removeRasterLayer(map: maplibregl.Map, sourceId: string, layerId: string) {
  if (!map || typeof map.getLayer !== 'function') return
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId)
    if (map.getSource(sourceId)) map.removeSource(sourceId)
  } catch {
    // Map may have already been destroyed via m.remove() — safe to ignore.
  }
}

function resolveBlendForZoom(zoom: number) {
  // 0 = fully local layer, 1 = fully wide composite layer.
  return zoom <= RADAR_FALLBACK_MAX_ZOOM ? 1 : 0
}

function setBlendOpacities(map: maplibregl.Map, baseOpacity: number, blend: number) {
  if (!map || typeof map.getLayer !== 'function') return
  if (map.getLayer(LAYER_LOCAL)) {
    map.setPaintProperty(LAYER_LOCAL, 'raster-opacity', baseOpacity * (1 - blend))
  }
  if (map.getLayer(LAYER_WIDE)) {
    map.setPaintProperty(LAYER_WIDE, 'raster-opacity', baseOpacity * blend)
  }
}

function refreshSourceTiles(
  map: maplibregl.Map,
  sourceId: string,
  layerId: string,
  layerSlug: string,
  bust: number,
) {
  const source = map.getSource(sourceId) as maplibregl.RasterTileSource | undefined
  const nextTile = tileUrl(layerSlug, bust)

  if (source?.setTiles) {
    source.setTiles([nextTile])
    map.triggerRepaint()
    return
  }

  removeRasterLayer(map, sourceId, layerId)
  addRasterLayer(map, sourceId, layerId, layerSlug, bust, 0)
}

export function RadarLayer({ map, forceVisible }: Props) {
  // ── All hooks must be called unconditionally (Rules of Hooks) ──────────────
  const radarVisible = useCivicStore((s) => s.radarVisible)
  const radarOpacity = useCivicStore((s) => s.radarOpacity)
  // Keep a stable ref to opacity so the refresh interval always uses the
  // current value without being a dependency that restarts the timer.
  const opacityRef = useRef(radarOpacity)
  opacityRef.current = radarOpacity
  const blendRef = useRef(0)
  const crossfadeRafRef = useRef<number | null>(null)

  // Mount/unmount the layer + refresh every RADAR_REFRESH_MS
  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!forceVisible && !radarVisible) return

    const cancelCrossfade = () => {
      if (crossfadeRafRef.current != null) {
        cancelAnimationFrame(crossfadeRafRef.current)
        crossfadeRafRef.current = null
      }
    }

    const render = (bust: number) => {
      refreshSourceTiles(map, SRC_LOCAL, LAYER_LOCAL, RADAR_LAYER, bust)
      refreshSourceTiles(map, SRC_WIDE, LAYER_WIDE, RADAR_FALLBACK_LAYER, bust)
      setBlendOpacities(map, opacityRef.current, blendRef.current)
    }

    const animateBlendTo = (targetBlend: number) => {
      if (targetBlend === blendRef.current) return
      cancelCrossfade()

      const start = performance.now()
      const from = blendRef.current
      const delta = targetBlend - from

      const tick = (now: number) => {
        const t = Math.min((now - start) / CROSSFADE_MS, 1)
        const eased = t * t * (3 - 2 * t)
        blendRef.current = from + delta * eased
        setBlendOpacities(map, opacityRef.current, blendRef.current)

        if (t < 1) {
          crossfadeRafRef.current = requestAnimationFrame(tick)
        } else {
          crossfadeRafRef.current = null
        }
      }

      crossfadeRafRef.current = requestAnimationFrame(tick)
    }

    blendRef.current = resolveBlendForZoom(map.getZoom())
    render(Date.now())

    const onZoomEnd = () => {
      animateBlendTo(resolveBlendForZoom(map.getZoom()))
    }
    map.on('zoomend', onZoomEnd)

    const timer = setInterval(() => {
      render(Date.now())
    }, RADAR_REFRESH_MS)

    return () => {
      cancelCrossfade()
      clearInterval(timer)
      if (map && typeof map.off === 'function') {
        map.off('zoomend', onZoomEnd)
        removeRasterLayer(map, SRC_LOCAL, LAYER_LOCAL)
        removeRasterLayer(map, SRC_WIDE, LAYER_WIDE)
      }
    }
  }, [map, radarVisible, forceVisible])

  // Opacity-only updates — preserve current blend position while updating alpha.
  useEffect(() => {
    if (map && typeof map.getLayer === 'function') {
      setBlendOpacities(map, radarOpacity, blendRef.current)
    }
  }, [map, radarOpacity])

  return null
}
