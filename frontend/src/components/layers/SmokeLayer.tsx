import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'

interface Props { map: maplibregl.Map }

const SRC_SMOKE = 'smoke-overlay'
const LYR_SMOKE = 'smoke-overlay-layer'

const SMOKE_WMS_PROXY = `${API_BASE}/weather/smoke/wms`

export function SmokeLayer({ map }: Props) {
  const smokeVisible = useCivicStore((s) => s.smokeVisible)

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return

    // Cache-busting timestamp updated every 5 minutes.
    const getTiles = () => {
      const now = new Date()
      now.setMinutes(Math.floor(now.getMinutes() / 5) * 5, 0, 0)
      const ts = now.getTime()
      return [
        `${SMOKE_WMS_PROXY}?service=WMS&request=GetMap&version=1.3.0&layers=goes_visible_imagery&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&_ts=${ts}`,
      ]
    }

    if (!map.getSource(SRC_SMOKE)) {
      map.addSource(SRC_SMOKE, {
        type: 'raster',
        tiles: getTiles(),
        tileSize: 256,
      })
      map.addLayer({
        id: LYR_SMOKE,
        type: 'raster',
        source: SRC_SMOKE,
        paint: {
          'raster-opacity': 0.45,
        },
      })
    }

    // Update tiles periodically.
    const interval = setInterval(() => {
      const source = map.getSource(SRC_SMOKE) as maplibregl.RasterTileSource
      if (source) {
        source.setTiles(getTiles())
      }
    }, 5 * 60 * 1000)

    const vis = smokeVisible ? 'visible' : 'none'
    try {
      if (map.getLayer(LYR_SMOKE)) {
        map.setLayoutProperty(LYR_SMOKE, 'visibility', vis)
      }
    } catch { /* ignore */ }

    return () => clearInterval(interval)
  }, [map, smokeVisible])

  return null
}
