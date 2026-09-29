import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { useCivicStore } from '../../store'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props { map: maplibregl.Map }

const SRC  = 'power-outages'
const FILL = 'power-outages-fill'
const LINE = 'power-outages-line'

// Census-tract areas with meters out (Oregon ODIN). Amber, deeper as more meters are out — outages
// are a caution, not an emergency, so the emergency red stays reserved for life safety.
const AMBER: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'meters_out'],
  1, '#B88600',    // amber-gold-dim
  50, '#FFB800',   // amber-gold
  500, '#FF8F00',  // amber-p25
]

export function OutagesLayer({ map }: Props) {
  const visible = useCivicStore((s) => s.outagesVisible)
  const lastFetchRef = useRef(0)

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: FILL, type: 'fill', source: SRC, paint: { 'fill-color': AMBER, 'fill-opacity': 0.32 } })
      map.addLayer({ id: LINE, type: 'line', source: SRC, paint: { 'line-color': AMBER, 'line-width': 1.6, 'line-opacity': 0.9 } })
    }

    if (visible && Date.now() - lastFetchRef.current > 2 * 60 * 1000) {
      lastFetchRef.current = Date.now()
      fetch(`${API_BASE}/utilities/outages`, { headers: authHeaders() })
        .then((r) => (r.ok ? r.json() : null))
        .then((geojson) => {
          if (!geojson?.features) return
          ;(map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(geojson)
        })
        .catch(() => { /* ignore */ })
    }

    const vis = visible ? 'visible' : 'none'
    try {
      for (const id of [FILL, LINE]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
    } catch { /* ignore */ }
  }, [map, visible])

  return null
}
