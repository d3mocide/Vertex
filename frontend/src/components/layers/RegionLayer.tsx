import { useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import type { Region } from '../../hooks/useRegions'

interface Props {
  map: maplibregl.Map
  regions: Region[]
}

const SRC_ID   = 'region-bounds-src'
const FILL_ID  = 'region-bounds-fill'
const LINE_ID  = 'region-bounds-line'

function buildGeoJSON(regions: Region[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: regions.filter(r => r.enabled).map(r => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [r.bbox.min_lon, r.bbox.min_lat],
          [r.bbox.max_lon, r.bbox.min_lat],
          [r.bbox.max_lon, r.bbox.max_lat],
          [r.bbox.min_lon, r.bbox.max_lat],
          [r.bbox.min_lon, r.bbox.min_lat],
        ]],
      },
      properties: { id: r.id, name: r.name },
    })),
  }
}

export function RegionLayer({ map, regions }: Props) {
  useEffect(() => {
    if (!map || typeof map.getSource !== 'function') return

    const geojson = buildGeoJSON(regions)

    if (!map.getSource(SRC_ID)) {
      map.addSource(SRC_ID, { type: 'geojson', data: geojson })
      map.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SRC_ID,
        paint: {
          'fill-color': '#ffb800',
          'fill-opacity': 0.04,
        },
      })
      map.addLayer({
        id: LINE_ID,
        type: 'line',
        source: SRC_ID,
        paint: {
          'line-color': '#ffb800',
          'line-opacity': 0.47,
          'line-width': 1.5,
          'line-dasharray': [4, 3],
        },
      })
    } else {
      (map.getSource(SRC_ID) as maplibregl.GeoJSONSource).setData(geojson)
    }
  }, [map, regions])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map || typeof map.getLayer !== 'function') return
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID)
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID)
        if (map.getSource(SRC_ID)) map.removeSource(SRC_ID)
      } catch { /* ignore */ }
    }
  }, [map])

  return null
}
