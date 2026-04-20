import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'mesh-nodes'
const LAYER = 'mesh-node-points'
const STALE_MS = 10 * 60 * 1000  // 10 minutes

export function MeshLayer({ map }: Props) {
  const nodes       = useEntitiesByType('mesh_node')
  const selectEntity = useCivicStore((s) => s.selectEntity)

  useEffect(() => {
    const now = Date.now()

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: nodes.map((n) => {
        const lastMs  = n.last_seen ? Date.parse(n.last_seen) : 0
        const isStale = now - lastMs > STALE_MS
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [n.lon!, n.lat!] },
          properties: {
            id:     n.entity_id,
            name:   n.display_name ?? n.entity_id,
            status: n.status ?? '',
            stale:  isStale,
          },
        }
      }),
    }

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: geojson })

      // Outer ring — grey when stale, green when fresh
      map.addLayer({
        id: `${LAYER}-ring`,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius': 9,
          'circle-color': ['case', ['get', 'stale'], '#555', '#1a9641'],
          'circle-opacity': 0.3,
        },
      })

      // Inner dot
      map.addLayer({
        id: LAYER,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['get', 'stale'], '#888', '#4dac26'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
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
  }, [nodes, map])

  return null
}
