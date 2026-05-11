import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface MeshLink {
  node_a: string
  node_b: string
  snr: number | null
  link_quality: number | null
}

const SOURCE_ID = 'mesh-links'
const LAYER_ID = 'mesh-links-line'

function snrToColor(snr: number | null): [number, number, number] {
  if (snr === null) return [150, 150, 150]
  if (snr >= -70) return [68, 221, 136]   // strong — green
  if (snr >= -90) return [255, 184, 0]    // medium — amber
  return [255, 80, 80]                    // weak — red
}

function snrToColorHex(snr: number | null): string {
  const [r, g, b] = snrToColor(snr)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

interface Props {
  map: MapLibreMap
}

export function MeshLinksLayer({ map }: Props) {
  const entities = useCivicStore((s) => s.entities)
  const meshLinks = useCivicStore((s) => s.meshLinks)

  // Initialize Layer and Source
  useEffect(() => {
    if (!map) return

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })

      map.addLayer({
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8,
          'line-dasharray': [4, 2],
        },
      })
    }

    return () => {
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch (err) {
        console.debug('[MeshLinksLayer] cleanup failed:', err)
      }
    }
  }, [map])

  // Update Data
  useEffect(() => {
    if (!map) return
    const source = map.getSource(SOURCE_ID) as any
    if (!source) return

    const features = meshLinks.flatMap((link) => {
      const nodeA = entities[link.node_a]
      const nodeB = entities[link.node_b]
      if (!nodeA?.lat || !nodeA?.lon || !nodeB?.lat || !nodeB?.lon) return []
      
      return [{
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [nodeA.lon, nodeA.lat],
            [nodeB.lon, nodeB.lat],
          ],
        },
        properties: {
          snr: link.snr,
          color: snrToColorHex(link.snr),
        },
      }]
    })

    source.setData({
      type: 'FeatureCollection',
      features
    })
  }, [map, entities, meshLinks])

  return null
}
