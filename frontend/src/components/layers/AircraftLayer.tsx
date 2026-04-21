import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'aircraft'
const LAYER = 'aircraft-points'

export function AircraftLayer({ map }: Props) {
  const aircraft     = useEntitiesByType('aircraft')
  const selectEntity = useCivicStore((s) => s.selectEntity)

  useEffect(() => {
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: aircraft.map((ac) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ac.lon!, ac.lat!] },
        properties: {
          id:       ac.entity_id,
          name:     ac.display_name ?? ac.entity_id,
          altitude: ac.altitude ?? 0,
          heading:  ac.heading  ?? 0,
          speed:    ac.speed    ?? 0,
        },
      })),
    }

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: geojson })

      // Outer glow ring — cyan for ADS-B
      map.addLayer({
        id: `${LAYER}-glow`,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius':  10,
          'circle-color':   '#00BFFF',
          'circle-opacity': 0.15,
        },
      })

      // Inner dot
      map.addLayer({
        id: LAYER,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius':       5,
          'circle-color':        '#00BFFF',
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
  }, [aircraft, map])

  return null
}
