import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'

interface Props {
  map: maplibregl.Map
}

const SRC_ID  = 'rail-tracks-src'
const LINE_ID = 'rail-tracks-line'

export function RailLayer({ map }: Props) {
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!map || typeof map.getSource !== 'function') return
    if (loadedRef.current) return

    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/rail/tracks`, { headers: authHeaders() })
        if (!res.ok) return
        const geojson = await res.json()

        if (map.getSource(SRC_ID)) return  // already added (strict-mode double-effect guard)

        map.addSource(SRC_ID, { type: 'geojson', data: geojson })
        map.addLayer({
          id: LINE_ID,
          type: 'line',
          source: SRC_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': [
              'match',
              ['get', 'railway'],
              'light_rail', '#a78bfa',  // violet for light rail / MAX
              '#78716c',                // stone-500 for mainline freight/Amtrak
            ],
            'line-width': [
              'interpolate', ['linear'], ['zoom'],
              6, 1,
              10, 2,
              14, 3,
            ],
            'line-opacity': 0.7,
          },
        })

        loadedRef.current = true
      } catch {
        // Overpass API may be slow on first load; fail silently, retry on next mount
      }
    }

    if (map.isStyleLoaded()) {
      load()
    } else {
      map.once('load', load)
    }
  }, [map])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map || typeof map.getLayer !== 'function') return
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
        if (map.getSource(SRC_ID)) map.removeSource(SRC_ID)
      } catch { /* ignore */ }
    }
  }, [map])

  return null
}
