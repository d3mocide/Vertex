import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import { useEntitiesByType } from '../../hooks/useEntities'
import { useCivicStore } from '../../store'

interface Props { map: maplibregl.Map }

const SRC   = 'mesh-nodes'
const LAYER = 'mesh-node-points'
const STALE_MS = 10 * 60 * 1000  // 10 minutes

export function MeshLayer({ map }: Props) {
  const nodes          = useEntitiesByType('mesh_node')
  const selectEntity   = useCivicStore((s) => s.selectEntity)
  const meshVisible    = useCivicStore((s) => s.entityFilter.mesh_node)

  useEffect(() => {
    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (f?.properties?.id) selectEntity(f.properties.id as string)
    }
    const handleEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const handleLeave = () => { map.getCanvas().style.cursor = '' }

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
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
      map.on('click', LAYER, handleClick)
      map.on('mouseenter', LAYER, handleEnter)
      map.on('mouseleave', LAYER, handleLeave)
    }

    return () => {
      map.off('click', LAYER, handleClick)
      map.off('mouseenter', LAYER, handleEnter)
      map.off('mouseleave', LAYER, handleLeave)
      if (map.getLayer(`${LAYER}-ring`)) map.removeLayer(`${LAYER}-ring`)
      if (map.getLayer(LAYER)) map.removeLayer(LAYER)
      if (map.getSource(SRC)) map.removeSource(SRC)
    }
  }, [map, selectEntity])

  useEffect(() => {
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const now = Date.now()
    const visibleNodes = meshVisible ? nodes : []
    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: visibleNodes.map((n) => {
        const lastMs  = n.last_seen ? Date.parse(n.last_seen) : 0
        const isStale = now - lastMs > STALE_MS
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [n.lon!, n.lat!] },
          properties: { id: n.entity_id, name: n.display_name ?? n.entity_id, status: n.status ?? '', stale: isStale },
        }
      }),
    }
    src.setData(geojson)
  }, [nodes, map, meshVisible])

  return null
}
