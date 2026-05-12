import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'

interface Props {
  map: maplibregl.Map
  visible?: boolean
  opacity?: number
}

const SRC_RADAR = 'noaa-radar-reflectivity'
const LYR_RADAR = 'noaa-radar-reflectivity-layer'

const RADAR_WMS_PROXY = `${API_BASE}/weather/radar/wms`

export function RadarReflectivityLayer({ map, visible, opacity }: Props) {
  const storeVisible = useCivicStore((s) => s.radarReflectivityVisible)
  const storeOpacity = useCivicStore((s) => s.radarOpacity)

  const isVisible = visible !== undefined ? visible : storeVisible
  const currentOpacity = opacity !== undefined ? opacity : storeOpacity

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!isVisible) return

    const render = (bust: number) => {
      const url = `${RADAR_WMS_PROXY}?service=WMS&request=GetMap&version=1.3.0&layers=weather_radar:conus_base_reflectivity_mosaic&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&_=${bust}`
      
      const source = map.getSource(SRC_RADAR) as maplibregl.RasterTileSource | undefined
      if (source) {
        source.setTiles([url])
        map.triggerRepaint()
      } else {
        map.addSource(SRC_RADAR, {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          attribution: 'NOAA nowCOAST',
        })
        map.addLayer({
          id: LYR_RADAR,
          type: 'raster',
          source: SRC_RADAR,
          paint: {
            'raster-opacity': currentOpacity,
          },
        })
      }
    }

    render(Date.now())

    const timer = setInterval(() => {
      render(Date.now())
    }, 5 * 60_000) // 5 min refresh

    try {
      if (map.getLayer(LYR_RADAR)) {
        map.setLayoutProperty(LYR_RADAR, 'visibility', 'visible')
      }
    } catch { /* ignore */ }

    return () => {
      clearInterval(timer)
      try {
        if (map.getLayer(LYR_RADAR)) {
          map.setLayoutProperty(LYR_RADAR, 'visibility', 'none')
        }
      } catch { /* ignore */ }
    }
  }, [map, isVisible])

  // Sync opacity
  useEffect(() => {
    if (map && map.getLayer(LYR_RADAR)) {
      map.setPaintProperty(LYR_RADAR, 'raster-opacity', currentOpacity)
    }
  }, [map, currentOpacity])

  return null
}
