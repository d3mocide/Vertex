import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'vessels'
const LAYER = 'vessel-points'

export function VesselLayer({ map }: Props) {
  const vessels      = useEntitiesByType('vessel')
  const selectEntity = useCivicStore((s) => s.selectEntity)

  useEffect(() => {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: vessels.map((v) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [v.lon!, v.lat!] },
        properties: {
          id:      v.entity_id,
          name:    v.display_name ?? v.entity_id,
          heading: v.heading ?? 0,
          speed:   v.speed ?? 0,
        },
      })),
    }

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: geojson })

      // Outer glow ring
      map.addLayer({
        id: `${LAYER}-glow`,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius':  10,
          'circle-color':   '#00C853',
          'circle-opacity': 0.15,
        },
      })

      // Inner dot — emerald green for AIS
      map.addLayer({
        id: LAYER,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius':       6,
          'circle-color':        '#00C853',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.on('click', LAYER, (e) => {
        const f = e.features?.[0]
        if (f?.properties?.id) selectEntity(f.properties.id as string)
      })
      map.on('mouseenter', LAYER, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', LAYER, () => { map.getCanvas().style.cursor = '' })
    } else {
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }, [vessels, map])

  return null
}
