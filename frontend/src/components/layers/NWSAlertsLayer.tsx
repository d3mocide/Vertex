import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'

interface Props {
  map: maplibregl.Map
  visible?: boolean
}

const SRC_ALERTS = 'nws-alerts-overlay'
const LYR_ALERTS = 'nws-alerts-layer'

const ALERTS_WMS_PROXY = `${API_BASE}/weather/alerts/wms`

export function NWSAlertsLayer({ map, visible }: Props) {
  const storeVisible = useCivicStore((s) => s.nwsAlertsVisible)
  const isVisible = visible !== undefined ? visible : storeVisible

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!isVisible) return

    const render = (bust: number) => {
      const url = `${ALERTS_WMS_PROXY}?service=WMS&request=GetMap&version=1.3.0&layers=alerts:watches_warnings_advisories&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&_=${bust}`
      
      const source = map.getSource(SRC_ALERTS) as maplibregl.RasterTileSource | undefined
      if (source) {
        source.setTiles([url])
        map.triggerRepaint()
      } else {
        map.addSource(SRC_ALERTS, {
          type: 'raster',
          tiles: [url],
          tileSize: 256,
          attribution: 'NWS',
        })
        map.addLayer({
          id: LYR_ALERTS,
          type: 'raster',
          source: SRC_ALERTS,
          paint: {
            'raster-opacity': 0.65,
          },
        })
      }
    }

    render(Date.now())

    const timer = setInterval(() => {
      render(Date.now())
    }, 5 * 60_000) // 5 min refresh

    try {
      if (map.getLayer(LYR_ALERTS)) {
        map.setLayoutProperty(LYR_ALERTS, 'visibility', 'visible')
      }
    } catch { /* ignore */ }

    return () => {
      clearInterval(timer)
      try {
        if (map.getLayer(LYR_ALERTS)) {
          map.setLayoutProperty(LYR_ALERTS, 'visibility', 'none')
        }
      } catch { /* ignore */ }
    }
  }, [map, isVisible])

  return null
}
