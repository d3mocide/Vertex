import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { useCivicStore } from '../../store'

interface Props {
  map: maplibregl.Map
}

const SRC_ID  = 'rail-tracks-src'
const LINE_ID = 'rail-tracks-line'

export function RailLayer({ map }: Props) {
  const railTracksVisible = useCivicStore(s => s.railTracksVisible)
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
              '#b45309',                // amber-700 rust for mainline freight/Amtrak
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
        // Overpass API may be slow on first load; retry will fire via the interval below
      }
    }

    // Initial attempt
    if (map.isStyleLoaded()) {
      load()
    } else {
      map.once('load', load)
    }

    // Retry every 30 s until the backend Overpass cache warms up after a rebuild
    const retryInterval = setInterval(() => {
      if (!loadedRef.current) load()
    }, 30_000)

    return () => clearInterval(retryInterval)
  }, [map])

  // Toggle layer visibility when railTracksVisible changes
  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    if (!map.getLayer(LINE_ID)) return
    map.setLayoutProperty(LINE_ID, 'visibility', railTracksVisible ? 'visible' : 'none')
  }, [map, railTracksVisible])

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
