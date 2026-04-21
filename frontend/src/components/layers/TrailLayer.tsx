import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'entity-trail'
const LAYER = 'entity-trail-line'

export function TrailLayer({ map }: Props) {
  const trail = useCivicStore((s) => s.trail)

  // Initialize source + layer once on mount — added first so it renders below entity dots
  useEffect(() => {
    if (map.getSource(SRC)) return
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id:     LAYER,
      type:   'line',
      source: SRC,
      paint: {
        'line-color':   '#ffcc00',
        'line-width':   2,
        'line-opacity': 0.75,
      },
    })
  }, [map])

  // Update GeoJSON data whenever trail changes
  useEffect(() => {
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const coords = trail
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => [p.lon!, p.lat!] as [number, number])
    src.setData({
      type: 'FeatureCollection',
      features: coords.length > 1
        ? [{
            type:       'Feature',
            geometry:   { type: 'LineString', coordinates: coords },
            properties: {},
          }]
        : [],
    })
  }, [trail, map])

  return null
}
