import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props { map: maplibregl.Map }

const SRC  = 'fire-danger'
const FILL = 'fire-danger-fill'
const LINE = 'fire-danger-line'

// ODF public fire danger, 1 Low … 4 Extreme. Same signal colours as the rest of
// the app: green = nominal, amber-gold = caution, amber-p25 orange = serious,
// red-emergency = extreme.
const DANGER_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'danger'],
  1, '#00C853',
  2, '#FFB800',
  3, '#FF8F00',
  4, '#C62828',
  '#8C8C8C',
]

export function FireDangerLayer({ map }: Props) {
  const visible = useCivicStore((s) => s.fireDangerVisible)
  const lastFetchRef = useRef(0)

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!visible) {
      for (const id of [FILL, LINE]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }
      return
    }
    const controller = new AbortController()

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: FILL, type: 'fill', source: SRC,
        paint: { 'fill-color': DANGER_COLOR, 'fill-opacity': ['match', ['get', 'danger'], 1, 0.08, 2, 0.16, 3, 0.26, 0.34] },
      })
      map.addLayer({
        id: LINE, type: 'line', source: SRC,
        paint: { 'line-color': DANGER_COLOR, 'line-width': 1.2, 'line-opacity': 0.7 },
      })
    }

    if (visible && Date.now() - lastFetchRef.current > 5 * 60 * 1000) {
      fetch(`${API_BASE}/weather/fire/danger`, { headers: authHeaders(), signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((geojson) => {
          if (controller.signal.aborted || !geojson?.features) return
          lastFetchRef.current = Date.now()
          ;(map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(geojson)
        })
        .catch(() => { /* ignore */ })
    }

    const vis = visible ? 'visible' : 'none'
    try {
      for (const id of [FILL, LINE]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    } catch { /* ignore */ }
    return () => controller.abort()
  }, [map, visible])

  return null
}
