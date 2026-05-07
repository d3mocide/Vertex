import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC_SMOKE = 'smoke-overlay'
const LYR_SMOKE = 'smoke-overlay-layer'

const SMOKE_WMS =
  'https://satepsanone.nesdis.noaa.gov/arcgis/services/FIRE/HMS_Smoke/MapServer/WMSServer'

export function SmokeLayer({ map }: Props) {
  const smokeVisible = useCivicStore((s) => s.smokeVisible)

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return

    if (!map.getSource(SRC_SMOKE)) {
      map.addSource(SRC_SMOKE, {
        type: 'raster',
        tiles: [
          `${SMOKE_WMS}?service=WMS&request=GetMap&version=1.1.1&layers=0&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`,
        ],
        tileSize: 256,
      })
      map.addLayer({
        id: LYR_SMOKE,
        type: 'raster',
        source: SRC_SMOKE,
        paint: {
          'raster-opacity': 0.35,
        },
      })
    }

    const vis = smokeVisible ? 'visible' : 'none'
    try {
      if (map.getLayer(LYR_SMOKE)) {
        map.setLayoutProperty(LYR_SMOKE, 'visibility', vis)
      }
    } catch { /* ignore */ }
  }, [map, smokeVisible])

  return null
}
