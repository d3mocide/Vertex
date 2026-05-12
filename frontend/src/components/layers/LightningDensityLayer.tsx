import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'

interface Props {
  map: maplibregl.Map
  visible?: boolean
}

const SRC_LIGHTNING = 'noaa-lightning-density'
const LYR_LIGHTNING = 'noaa-lightning-layer'

const LIGHTNING_WMS_PROXY = `${API_BASE}/weather/lightning/wms`

export function LightningDensityLayer({ map, visible }: Props) {
  const storeVisible = useCivicStore((s) => s.lightningDensityVisible)
  const isVisible = visible !== undefined ? visible : storeVisible

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!isVisible) return

    const render = (bust: number) => {
      const url = `${LIGHTNING_WMS_PROXY}?service=WMS&request=GetMap&version=1.3.0&layers=lightning_detection:ldn_lightning_strike_density&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&_=${bust}`
      
      const source = map.getSource(SRC_LIGHTNING) as maplibregl.RasterTileSource | undefined
      if (source) {
        source.setTiles([url])
        map.triggerRepaint()
      } else {
        map.addSource(SRC_LIGHTNING, {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          attribution: 'NOAA',
        })
        map.addLayer({
          id: LYR_LIGHTNING,
          type: 'raster',
          source: SRC_LIGHTNING,
          paint: {
            'raster-opacity': 0.8,
          },
        })
      }
    }

    render(Date.now())

    const timer = setInterval(() => {
      render(Date.now())
    }, 5 * 60_000) // 5 min refresh

    try {
      if (map.getLayer(LYR_LIGHTNING)) {
        map.setLayoutProperty(LYR_LIGHTNING, 'visibility', 'visible')
      }
    } catch { /* ignore */ }

    return () => {
      clearInterval(timer)
      try {
        if (map.getLayer(LYR_LIGHTNING)) {
          map.setLayoutProperty(LYR_LIGHTNING, 'visibility', 'none')
        }
      } catch { /* ignore */ }
    }
  }, [map, isVisible])

  return null
}
