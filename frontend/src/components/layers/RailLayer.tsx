import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { API_BASE } from '../../config'
import { authHeaders } from '../../auth'
import { useCivicStore } from '../../store'

interface Props {
  map: maplibregl.Map
}

const OSM_SRC_ID   = 'rail-tracks-src'
const OSM_LINE_ID  = 'rail-tracks-line'
const GTFS_SRC_ID  = 'rail-gtfs-src'
const GTFS_LINE_ID = 'rail-gtfs-line'

export function RailLayer({ map }: Props) {
  const railTracksVisible = useCivicStore(s => s.railTracksVisible)
  const osmLoadedRef  = useRef(false)
  const gtfsLoadedRef = useRef(false)

  useEffect(() => {
    if (!map || typeof map.getSource !== 'function') return

    // OSM tracks — basemap-style rail geometry for all mainline/freight/Amtrak
    const loadOsm = async () => {
      if (osmLoadedRef.current) return
      try {
        const res = await fetch(`${API_BASE}/rail/tracks`, { headers: authHeaders() })
        if (!res.ok) return
        const geojson = await res.json()
        if (map.getSource(OSM_SRC_ID)) return

        map.addSource(OSM_SRC_ID, { type: 'geojson', data: geojson })
        // Insert OSM below the GTFS layer if it already loaded; otherwise append
        const beforeId = map.getLayer(GTFS_LINE_ID) ? GTFS_LINE_ID : undefined
        map.addLayer(
          {
            id: OSM_LINE_ID,
            type: 'line',
            source: OSM_SRC_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
              'line-color': [
                'match', ['get', 'railway'],
                'light_rail', '#a78bfa',
                '#b45309',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.5, 14, 2.5],
              'line-opacity': 0.45,
            },
          },
          beforeId,
        )
        osmLoadedRef.current = true
      } catch { /* retry via interval */ }
    }

    // GTFS shapes — official TriMet route geometry with per-route brand colors
    const loadGtfs = async () => {
      if (gtfsLoadedRef.current) return
      try {
        const res = await fetch(`${API_BASE}/rail/gtfs-shapes`, { headers: authHeaders() })
        if (!res.ok) return
        const geojson = await res.json()
        // Empty means the poller hasn't run yet; retry later
        if (!geojson.features?.length) return
        if (map.getSource(GTFS_SRC_ID)) return

        map.addSource(GTFS_SRC_ID, { type: 'geojson', data: geojson })
        map.addLayer({
          id: GTFS_LINE_ID,
          type: 'line',
          source: GTFS_SRC_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['get', 'route_color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 3.5, 14, 6],
            'line-opacity': 0.9,
          },
        })
        gtfsLoadedRef.current = true
      } catch { /* retry via interval */ }
    }

    const loadAll = () => { loadOsm(); loadGtfs() }

    if (map.isStyleLoaded()) {
      loadAll()
    } else {
      map.once('load', loadAll)
    }

    // Retry every 30 s until both sources are loaded (Overpass and poller cache warm-up)
    const retryInterval = setInterval(() => {
      if (!osmLoadedRef.current || !gtfsLoadedRef.current) loadAll()
    }, 30_000)

    return () => clearInterval(retryInterval)
  }, [map])

  useEffect(() => {
    if (!map || typeof map.getLayer !== 'function') return
    const vis = railTracksVisible ? 'visible' : 'none'
    if (map.getLayer(OSM_LINE_ID))  map.setLayoutProperty(OSM_LINE_ID,  'visibility', vis)
    if (map.getLayer(GTFS_LINE_ID)) map.setLayoutProperty(GTFS_LINE_ID, 'visibility', vis)
  }, [map, railTracksVisible])

  useEffect(() => {
    return () => {
      if (!map || typeof map.getLayer !== 'function') return
      try {
        if (map.getLayer(GTFS_LINE_ID)) map.removeLayer(GTFS_LINE_ID)
        if (map.getSource(GTFS_SRC_ID)) map.removeSource(GTFS_SRC_ID)
        if (map.getLayer(OSM_LINE_ID))  map.removeLayer(OSM_LINE_ID)
        if (map.getSource(OSM_SRC_ID))  map.removeSource(OSM_SRC_ID)
      } catch { /* ignore */ }
    }
  }, [map])

  return null
}
