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
  const lastFetchRef = useRef(0)

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
          'fill-opacity': 0.35,
        },
      })

      map.addLayer({
        id: LYR_LINE,
        type: 'line',
        source: SRC_PERIMS,
        paint: {
          'line-color': '#ff4400',
          'line-width': 2.5,
          'line-opacity': 1.0,
          'line-blur': 1,
        },
      })
    }

    // Load data when made visible (with a small cooldown to avoid hammering)
    if (firePerimetersVisible) {
      const now = Date.now()
      if (now - lastFetchRef.current > 60000) {
        lastFetchRef.current = now
        fetch(`${API_BASE}/weather/fire/perimeters`, { headers: authHeaders() })
          .then((r) => r.ok ? r.json() : null)
          .then((geojson) => {
            if (!geojson || !geojson.features) return
            const src = map.getSource(SRC_PERIMS) as maplibregl.GeoJSONSource | undefined
            src?.setData(geojson)
          })
          .catch(() => { /* ignore */ })
      }
    }

    const vis = firePerimetersVisible ? 'visible' : 'none'
    try {
      if (map.getLayer(LYR_FILL)) map.setLayoutProperty(LYR_FILL, 'visibility', vis)
      if (map.getLayer(LYR_LINE)) map.setLayoutProperty(LYR_LINE, 'visibility', vis)
    } catch { /* ignore */ }
  }, [map, firePerimetersVisible])

  return null
}
