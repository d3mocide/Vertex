import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { DEFAULT_CENTER, OBSERVATION_RANGE_KM } from '../../config'
import { destinationPoint } from '../../layers/geoUtils'

interface Props { map: maplibregl.Map }

const SRC_ID   = 'obs-ring-src'
const FILL_ID  = 'obs-ring-fill'
const LINE_ID  = 'obs-ring-line'

function buildCircleGeoJSON(center: [number, number], radiusKm: number, steps = 128) {
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = (i * 360) / steps
    ring.push(destinationPoint(center[0], center[1], bearing, radiusKm * 1_000))
  }
  return { type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [ring] }, properties: {} }
}

export function ObservationRingLayer({ map }: Props) {
  if (!map || typeof map.getLayer !== 'function') return null
  useEffect(() => {
    if (!OBSERVATION_RANGE_KM) return

    const geojson = buildCircleGeoJSON(DEFAULT_CENTER, OBSERVATION_RANGE_KM)

    map.addSource(SRC_ID, { type: 'geojson', data: geojson })

    map.addLayer({
      id:     FILL_ID,
      type:   'fill',
      source: SRC_ID,
      paint:  {
        'fill-color':   '#FFBA00',
        'fill-opacity': 0.03,
      },
    })

    map.addLayer({
      id:     LINE_ID,
      type:   'line',
      source: SRC_ID,
      paint:  {
        'line-color':     '#FFBA00',
        'line-opacity':   0.45,
        'line-width':     1.5,
        'line-dasharray': [4, 5],
      },
    })

    return () => {
      if (map && typeof map.getLayer === 'function') {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID)
        if (map.getSource(SRC_ID)) map.removeSource(SRC_ID)
      }
    }
  }, [map])

  return null
}
