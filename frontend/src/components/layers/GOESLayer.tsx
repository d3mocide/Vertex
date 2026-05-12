import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'

interface Props {
  map: maplibregl.Map
  visible?: boolean
}

const SRC_GOES = 'goes-overlay'
const LYR_GOES = 'goes-overlay-layer'

// Proxy endpoint in backend avoids browser CORS issues with nowCOAST.
const GOES_WMS_PROXY = `${API_BASE}/weather/goes/wms`

// NOAA nowCOAST GOES-East satellite imagery (IR channel 13 — clean longwave IR).
// Layer 18 in the nowcoast/sat_meteo_imagery_time service is GOES-East full disk
// composite IR. Use layer 17 for visible (daytime only).
const GOES_WMS_PARAMS = [
  'service=WMS',
  'request=GetMap',
  'version=1.3.0',
  'layers=goes_longwave_imagery',
  'styles=',
  'format=image/png',
  'transparent=true',
  'crs=EPSG:3857',
  'width=256',
  'height=256',
  'bbox={bbox-epsg-3857}',
].join('&')

export function GOESLayer({ map, visible }: Props) {
  const storeVisible = useCivicStore((s) => s.goesVisible)
  const isVisible = visible !== undefined ? visible : storeVisible

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!isVisible) return

    if (!map.getSource(SRC_GOES)) {
      map.addSource(SRC_GOES, {
        type: 'raster',
        tiles: [`${GOES_WMS_PROXY}?${GOES_WMS_PARAMS}`],
        tileSize: 256,
      })
      map.addLayer({
        id: LYR_GOES,
        type: 'raster',
        source: SRC_GOES,
        paint: { 'raster-opacity': 0.55 },
      })
    }

    try {
      if (map.getLayer(LYR_GOES)) {
        map.setLayoutProperty(LYR_GOES, 'visibility', 'visible')
      }
    } catch { /* ignore */ }

    return () => {
      try {
        if (map.getLayer(LYR_GOES)) {
          map.setLayoutProperty(LYR_GOES, 'visibility', 'none')
        }
      } catch { /* ignore */ }
    }
  }, [map, isVisible])

  return null
}
