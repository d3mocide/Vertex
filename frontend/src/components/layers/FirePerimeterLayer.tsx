import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props { map: maplibregl.Map }

const SRC_PERIMS = 'fire-perimeters'
const LYR_FILL   = 'fire-perimeters-fill'
const LYR_LINE   = 'fire-perimeters-line'

export function FirePerimeterLayer({ map }: Props) {
  const firePerimetersVisible = useCivicStore((s) => s.firePerimetersVisible)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return

    // Add source + layers once
    if (!map.getSource(SRC_PERIMS)) {
      map.addSource(SRC_PERIMS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      map.addLayer({
        id: LYR_FILL,
        type: 'fill',
        source: SRC_PERIMS,
        paint: {
          'fill-color': '#ff6600',
          'fill-opacity': 0.18,
        },
      })

      map.addLayer({
        id: LYR_LINE,
        type: 'line',
        source: SRC_PERIMS,
        paint: {
          'line-color': '#ff4400',
          'line-width': 1.5,
          'line-opacity': 0.8,
        },
      })
    }

    // Load data once when first made visible
    if (firePerimetersVisible && !loadedRef.current) {
      loadedRef.current = true
      fetch(`${API_BASE}/weather/fire/perimeters`, { headers: authHeaders() })
        .then((r) => r.ok ? r.json() : null)
        .then((geojson) => {
          if (!geojson) return
          const src = map.getSource(SRC_PERIMS) as maplibregl.GeoJSONSource | undefined
          src?.setData(geojson)
        })
        .catch(() => { /* keep empty */ })
    }

    const vis = firePerimetersVisible ? 'visible' : 'none'
    try {
      if (map.getLayer(LYR_FILL)) map.setLayoutProperty(LYR_FILL, 'visibility', vis)
      if (map.getLayer(LYR_LINE)) map.setLayoutProperty(LYR_LINE, 'visibility', vis)
    } catch { /* ignore */ }
  }, [map, firePerimetersVisible])

  return null
}
